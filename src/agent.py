"""Wise customer support voice agent.

Handles incoming calls and answers questions exclusively about the
"Where is my money?" FAQ section. Off-topic questions are deflected
and the call is ended. Detects caller frustration and generates
call summaries after each session.
"""

import asyncio
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from livekit import api
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    RunContext,
    cli,
    inference,
)
from livekit.agents.job import get_job_context
from livekit.agents.llm import ChatContext, function_tool
from livekit.plugins import elevenlabs, openai as lk_openai, silero

load_dotenv(dotenv_path=".env.local")
logger = logging.getLogger("wise-support")

SUMMARIES_DIR = Path("call_summaries")
SUMMARIES_DIR.mkdir(exist_ok=True)

SYSTEM_PROMPT = """\
You are a friendly and professional Wise customer support agent on a phone call.
You ONLY answer questions about the "Where is my money?" topic — the six FAQ
areas listed below. You must not answer questions outside this scope.

─── FAQ KNOWLEDGE BASE ───

1. HOW TO CHECK TRANSFER STATUS
The easiest way is to log in to your Wise account, go to Home to see your
activity list, and click on the transfer you want to track. Transfers go
through these statuses:
- "Your money's being processed" — Wise is waiting for your bank to send the funds.
- "Money received" — Wise has the funds and is converting the currency.
- "Transfer sent" — money has been sent to the recipient's bank, which will
  process and deliver it within a few working days.
If the transfer is stuck on "being processed" for over two working days, the
caller should check with their bank. Wise may also request extra verification
via email.

2. WHEN WILL MY MONEY ARRIVE
The caller should check the transfer tracker in their Wise account. If it says
"due today," the money should have arrived — banks just need a few hours to
process it. Not all banks operate on weekends or holidays; some stop processing
early on Fridays. The recipient should check for the sender name "Wise" on
their statement (not the sender's personal name). A PDF receipt can be
downloaded from the transfer details page using the three-dot menu.

3. TRANSFER MARKED COMPLETE BUT MONEY NOT ARRIVED
Wise marks a transfer "Complete" once it has been sent to the recipient's bank.
The bank may take up to one working day to release the funds. The recipient can
contact their bank with the transfer receipt to speed things up. The transfer
may appear under the name "Wise" rather than the sender's personal name.

4. TRANSFER TAKING LONGER THAN ESTIMATED
Common reasons for delays:
- Security checks: standard procedure, typically take 2–10 working days.
- Payment method: card payments are usually instant; bank transfers take 1–4
  working days; SWIFT transfers take 1–6 working days.
- Weekends and public holidays: banks don't process on these days, and
  estimates only count working days (Monday to Friday).
- Incorrect recipient details: typos may cause the bank to reject the payment
  and trigger a refund.
The caller should monitor progress in the Activity section and check email for
any verification requests from Wise.

5. WHAT IS A PROOF OF PAYMENT
A proof of payment is a document — such as a bank statement PDF or screenshot —
showing that money was sent. Wise may request it when funds haven't arrived in
time or to verify the money came from the caller's own account. The document
must show: full name, account number, bank name, Wise Ltd's name and account
number, payment date, amount, currency, and payment reference. For SWIFT
payments a pacs.008 document is required. In Australia or New Zealand, a recent
bank statement (not just a screenshot) is needed.

6. BANKING PARTNER REFERENCE NUMBER
Wise provides a transfer number for every transfer. For some transfers there is
also a banking partner reference number, because Wise uses local banking
partners in each country. Recipients need this number to track the transfer
with their bank once it shows as "Complete." In India, banks may call it a
"UTR number" or transaction reference number.

─── RULES ───

• Match the caller's question to one of the six topics above and answer using
  ONLY the information provided. Do not speculate or invent details.
• Keep answers concise — two to four spoken sentences. This is a phone call,
  not a chat. No markdown, no bullet points, no emojis.
• If the question does NOT match any of the six topics:
  1. Briefly acknowledge what they asked.
  2. Say: "That falls outside what I can help with today. Let me connect you
     with a team member who can assist you with that. Thank you for calling
     Wise, have a great day. Goodbye."
  3. Then call the end_call tool to disconnect.
• Be warm, patient, and professional at all times.
• If the caller asks a follow-up that is still within the six topics, continue
  helping normally.

─── SENTIMENT AWARENESS ───

Pay close attention to the caller's emotional state. If the caller sounds
frustrated, upset, or angry (e.g. repeated complaints, phrases like "this is
ridiculous", "I've been waiting forever", "this is unacceptable"):
1. Acknowledge their frustration empathetically: "I completely understand your
   frustration, and I'm sorry for the inconvenience."
2. If you can answer their question from the FAQ, do so with extra care.
3. If they remain upset after your answer or their issue is outside the FAQ
   scope, say you are fast-tracking them to a human agent and call end_call.
"""


class WiseSupportAgent(Agent):
    """Voice agent scoped to Wise 'Where is my money?' FAQs."""

    def __init__(self) -> None:
        super().__init__(instructions=SYSTEM_PROMPT)

    async def on_enter(self) -> None:
        self.session.generate_reply(
            instructions=(
                "Greet the caller warmly. Say something like: "
                "'Hi, thanks for calling Wise support! "
                "I can help you with questions about your transfer status "
                "and where your money is. How can I help you today?'"
            ),
        )

    @function_tool
    async def end_call(self, context: RunContext) -> None:  # noqa: ARG002
        """End the current call. Call this ONLY after you have already spoken
        your full deflection and goodbye message to the caller."""
        logger.info("Agent ending call — deflection or escalation")
        # Poll until current TTS playback finishes
        for _ in range(30):
            speech = self.session.current_speech
            if speech is None or speech.done():
                break
            await asyncio.sleep(0.5)
        await asyncio.sleep(1)
        # Delete the room to disconnect all participants (web + SIP)
        job_ctx = get_job_context()
        await job_ctx.api.room.delete_room(
            api.DeleteRoomRequest(room=job_ctx.room.name)
        )


server = AgentServer()


def prewarm(proc: JobProcess) -> None:
    """Pre-load the VAD model once per worker process."""
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


async def _generate_call_summary(session: AgentSession) -> None:
    """Generate and persist a structured call summary after a call ends."""
    history = session.history
    messages = [
        {"role": msg.role, "content": msg.text_content}
        for msg in history.items
        if hasattr(msg, "text_content") and msg.text_content
    ]

    if len(messages) <= 1:
        return

    transcript = "\n".join(
        f"{m['role'].upper()}: {m['content']}" for m in messages
    )

    summary_ctx = ChatContext()
    summary_ctx.add_message(
        role="system",
        content=(
            "You are a call center analyst. Given a call transcript between a "
            "Wise support agent and a caller, produce a structured JSON summary "
            "with these fields:\n"
            '- "caller_intent": what the caller wanted (1 sentence)\n'
            '- "topics_discussed": list of FAQ topics covered\n'
            '- "resolution": how the call ended (resolved / transferred / escalated)\n'
            '- "caller_sentiment": overall sentiment (positive / neutral / frustrated)\n'
            '- "follow_up_needed": true/false\n'
            '- "notes": any additional context (1-2 sentences)\n\n'
            "Respond ONLY with valid JSON."
        ),
    )
    summary_ctx.add_message(role="user", content=transcript)

    summary_llm = lk_openai.LLM(model="gpt-4.1-mini")
    response_text = ""
    async for chunk in summary_llm.chat(chat_ctx=summary_ctx):
        content = getattr(getattr(chunk, "delta", None), "content", None)
        if content:
            response_text += content

    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    summary_path = SUMMARIES_DIR / f"call_{timestamp}.json"

    try:
        summary_data = json.loads(response_text)
    except (json.JSONDecodeError, TypeError):
        summary_data = {"raw_summary": response_text, "parse_error": True}

    summary_data["timestamp"] = timestamp
    summary_data["transcript"] = messages
    summary_path.write_text(json.dumps(summary_data, indent=2))
    logger.info("Call summary saved → %s", summary_path)


@server.rtc_session(agent_name="wise-support")
async def entrypoint(ctx: JobContext) -> None:
    session = AgentSession(
        stt=inference.STT("deepgram/nova-3"),
        llm=inference.LLM("openai/gpt-4.1-mini"),
        tts=elevenlabs.TTS(voice_id="8fcyCHOzlKDlxh1InJSf"),
        vad=ctx.proc.userdata["vad"],
    )

    session.on("close", lambda _: asyncio.create_task(
        _generate_call_summary(session)
    ))

    await session.start(agent=WiseSupportAgent(), room=ctx.room)


if __name__ == "__main__":
    cli.run_app(server)
