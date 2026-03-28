"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  useVoiceAssistant,
  useTrackTranscription,
  useRoomContext,
} from "@livekit/components-react";
import { Track, RoomEvent, TranscriptionSegment } from "livekit-client";
import type { AgentState } from "@/components/ui/orb";
import "@livekit/components-styles";
import styles from "./page.module.css";

const Orb = dynamic(
  () => import("@/components/ui/orb").then((m) => m.Orb),
  { ssr: false }
);

const WISE_COLORS: [string, string] = ["#9FE870", "#4A8A3A"];

type ConnectionState = "idle" | "connecting" | "connected";

interface TokenResponse {
  serverUrl: string;
  token: string;
  roomName: string;
}

export default function Home() {
  const [state, setState] = useState<ConnectionState>("idle");
  const [tokenData, setTokenData] = useState<TokenResponse | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleConnect = useCallback(async () => {
    setState("connecting");
    try {
      const res = await fetch("/api/token", { method: "POST" });
      const data: TokenResponse = await res.json();
      setTokenData(data);
      setState("connected");
    } catch {
      setState("idle");
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    setState("idle");
    setTokenData(null);
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
  }, []);

  useEffect(() => {
    if (state === "connected") {
      const start = Date.now();
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - start) / 1000));
      }, 1000);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [state]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        <header className={styles.header}>
          <div className={styles.logo}>
            <svg className={styles.logoWordmark} xmlns="http://www.w3.org/2000/svg" width="106" height="24" fill="none" viewBox="0 0 106 24"><path fill="currentColor" d="M58.738.359h6.498L61.967 23.68h-6.498L58.738.359Zm-8.192 0L46.16 13.794 44.247.359h-4.545L33.961 13.754 33.243.359h-6.299L29.137 23.68h5.223L40.818 8.93 43.09 23.68h5.143L56.725.359h-6.18ZM105.103 13.914H89.674c.08 3.03 1.894 5.023 4.565 5.023 2.013 0 3.608-1.076 4.844-3.13l5.208 2.368C102.501 21.702 98.729 24 94.08 24c-6.34 0-10.545-4.266-10.545-11.123C83.535 5.342 88.478 0 95.455 0c6.14 0 10.007 4.146 10.007 10.605 0 1.076-.12 2.153-.36 3.309Zm-5.78-4.465c0-2.711-1.516-4.425-3.947-4.425-2.512 0-4.585 1.794-5.143 4.425h9.09ZM6.633 7.387 0 15.139h11.844l1.331-3.655H8.1l3.1-3.586.01-.095L9.194 4.332h9.072l-7.032 19.349h4.812L24.538.359H2.6l4.033 7.028Zm69.167-2.364c2.293 0 4.301 1.233 6.056 3.346l.921-6.575C81.143.688 78.93 0 76 0c-5.82 0-9.09 3.409-9.09 7.734 0 3 1.675 4.834 4.426 6.02l1.315.598c2.452 1.047 3.11 1.565 3.11 2.671 0 1.146-1.107 1.874-2.79 1.874-2.782.01-5.034-1.415-6.728-3.847l-.94 6.699C67.233 23.22 69.707 24 72.97 24c5.532 0 8.93-3.19 8.93-7.615 0-3.01-1.335-4.943-4.704-6.458l-1.435-.678c-1.994-.887-2.671-1.375-2.671-2.352 0-1.057.927-1.874 2.71-1.874Z"/></svg>
            <span className={styles.logoSuffix}>Support</span>
          </div>
          {state === "connected" && (
            <div className={styles.timer}>{formatTime(elapsed)}</div>
          )}
        </header>

        {state === "idle" && <IdleView onConnect={handleConnect} />}
        {state === "connecting" && <ConnectingView />}
        {state === "connected" && tokenData && (
          <LiveKitRoom
            serverUrl={tokenData.serverUrl}
            token={tokenData.token}
            connect={true}
            audio={true}
            onDisconnected={handleDisconnect}
            className={styles.room}
          >
            <ActiveCall onDisconnect={handleDisconnect} />
            <RoomAudioRenderer />
          </LiveKitRoom>
        )}
      </div>
    </main>
  );
}

function IdleView({ onConnect }: { onConnect: () => void }) {
  return (
    <div className={styles.idleView}>
      <div className={styles.orbWrapper}>
        <Orb colors={WISE_COLORS} seed={42} agentState="listening" />
      </div>

      <h1 className={styles.title}>Transfer Support</h1>
      <p className={styles.subtitle}>
        Get instant help with your Wise transfers.
        <br />
        Ask about transfer status, delays, and more.
      </p>

      <button className={styles.callButton} onClick={onConnect}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
        Start Call
      </button>

      <div className={styles.topics}>
        <span className={styles.topicTag}>Transfer Status</span>
        <span className={styles.topicTag}>Arrival Time</span>
        <span className={styles.topicTag}>Delays</span>
        <span className={styles.topicTag}>Proof of Payment</span>
        <span className={styles.topicTag}>Reference Numbers</span>
      </div>
    </div>
  );
}

function ConnectingView() {
  return (
    <div className={styles.connectingView}>
      <div className={styles.orbWrapper}>
        <Orb colors={WISE_COLORS} agentState="thinking" seed={42} />
      </div>
      <p className={styles.connectingText}>Connecting to agent...</p>
    </div>
  );
}

function mapAgentState(lkState: string): AgentState {
  switch (lkState) {
    case "speaking": return "talking";
    case "listening": return "listening";
    case "thinking": return "thinking";
    default: return null;
  }
}

interface TranscriptMessage {
  id: string;
  role: "user" | "agent";
  text: string;
  timestamp: number;
}

function ActiveCall({ onDisconnect }: { onDisconnect: () => void }) {
  const { state: agentState, audioTrack, agent } = useVoiceAssistant();
  const orbState = mapAgentState(agentState);

  const agentTrackRef = useMemo(() => {
    if (!agent || !audioTrack?.publication) return undefined;
    return {
      participant: agent,
      publication: audioTrack.publication,
      source: Track.Source.Microphone,
    };
  }, [agent, audioTrack?.publication]);

  const { segments: agentSegments } = useTrackTranscription(agentTrackRef);
  const [userMessages, setUserMessages] = useState<TranscriptMessage[]>([]);

  // Listen for user transcription events from the room
  const room = useRoomContext();
  useEffect(() => {
    if (!room) return;

    const handler = (
      segments: TranscriptionSegment[],
      participant: { identity: string } | undefined
    ) => {
      // Skip agent transcriptions — those come via useTrackTranscription
      if (participant?.identity === agent?.identity) return;

      for (const seg of segments) {
        if (seg.final && seg.text.trim()) {
          setUserMessages((prev) => {
            const exists = prev.some((m) => m.id === seg.id);
            if (exists) return prev;
            return [
              ...prev,
              {
                id: seg.id,
                role: "user" as const,
                text: seg.text,
                timestamp: Date.now(),
              },
            ];
          });
        }
      }
    };

    room.on(RoomEvent.TranscriptionReceived, handler);
    return () => { room.off(RoomEvent.TranscriptionReceived, handler); };
  }, [agent]);

  const allMessages = useMemo(() => {
    const msgs: TranscriptMessage[] = [...userMessages];
    for (const s of agentSegments) {
      if (s.text.trim()) {
        msgs.push({ id: `a-${s.id}`, role: "agent", text: s.text, timestamp: s.firstReceivedTime });
      }
    }
    msgs.sort((a, b) => a.timestamp - b.timestamp);
    return msgs;
  }, [agentSegments, userMessages]);

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [allMessages]);

  const stateLabel =
    agentState === "speaking"
      ? "Agent speaking"
      : agentState === "thinking"
        ? "Processing..."
        : agentState === "listening"
          ? "Listening"
          : "Connecting...";

  return (
    <div className={styles.activeCall}>
      <div className={styles.orbWrapper}>
        <Orb colors={WISE_COLORS} agentState={orbState} seed={42} />
      </div>

      <p className={styles.stateLabel}>{stateLabel}</p>

      <div className={styles.transcript} ref={scrollRef}>
        {allMessages.length === 0 && (
          <p className={styles.transcriptEmpty}>
            Conversation will appear here...
          </p>
        )}
        {allMessages.map((msg) => (
          <div
            key={msg.id}
            className={`${styles.message} ${
              msg.role === "user" ? styles.messageUser : styles.messageAgent
            }`}
          >
            <span className={styles.messageRole}>
              {msg.role === "user" ? "You" : "Agent"}
            </span>
            <p className={styles.messageText}>{msg.text}</p>
          </div>
        ))}
      </div>

      <button className={styles.endButton} onClick={onDisconnect}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.68 13.31a16 16 0 0 0 3.41 2.6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91"/>
          <line x1="23" y1="1" x2="1" y2="23"/>
        </svg>
        End Call
      </button>
    </div>
  );
}
