import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";

let sharedSocket: Socket | null = null;

function getSocket(): Socket {
  // One long-lived socket: socket.io reconnects by itself. (Re-creating it
  // whenever it was momentarily disconnected leaked sockets and delivered
  // every event several times.)
  if (!sharedSocket) {
    sharedSocket = io({
      path: "/api/socket.io",
      auth: (cb) => cb({ token: localStorage.getItem("lotus_token") }),
      transports: ["websocket", "polling"],
      reconnectionDelayMax: 10_000,
    });
  }
  return sharedSocket;
}

/** Drop the socket on login/logout so a new user never inherits the old session. */
export function resetSocket(): void {
  if (sharedSocket) {
    sharedSocket.removeAllListeners();
    sharedSocket.disconnect();
    sharedSocket = null;
  }
}

export function getSharedSocket(): Socket {
  return getSocket();
}

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    return () => {
      // Do not disconnect on unmount — keep the shared connection alive
    };
  }, []);

  return socketRef;
}

export function useConversationSocket(
  conversationId: number | null,
  onNewMessage: (msg: unknown) => void,
  onTyping?: (agentName: string) => void,
  currentUserName?: string,
) {
  const socketRef = useSocket();

  useEffect(() => {
    if (!conversationId) return;

    const socket = socketRef.current;
    if (!socket) return;

    socket.emit("join_conversation", conversationId);

    const handleNewMessage = (msg: unknown) => {
      onNewMessage(msg);
    };

    const handleTyping = ({ agentName }: { agentName: string; conversationId: number }) => {
      // Ignore own typing events to avoid displaying self-indicator
      if (currentUserName && agentName === currentUserName) return;
      onTyping?.(agentName);
    };

    socket.on("new_message", handleNewMessage);
    socket.on("typing", handleTyping);

    return () => {
      socket.emit("leave_conversation", conversationId);
      socket.off("new_message", handleNewMessage);
      socket.off("typing", handleTyping);
    };
  }, [conversationId, onNewMessage, onTyping, currentUserName]);

  return socketRef;
}

/**
 * Emits a `typing` event to the server with leading-edge throttle.
 * Emits immediately on the first keystroke, then suppresses further
 * emissions for `throttleMs` milliseconds to avoid socket flooding.
 */
export function useTypingEmit(
  conversationId: number | null,
  agentName: string | undefined,
  throttleMs = 2000,
) {
  const socketRef = useSocket();
  const throttledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emitTyping = useCallback(() => {
    if (!conversationId || !agentName) return;
    if (throttledRef.current) return;

    const socket = socketRef.current;
    if (!socket) return;

    socket.emit("typing", { conversationId, agentName });

    // Gate further emissions for throttleMs
    throttledRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      throttledRef.current = false;
      timerRef.current = null;
    }, throttleMs);
  }, [conversationId, agentName, throttleMs, socketRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return emitTyping;
}

/**
 * Returns the name of the agent currently typing, or null.
 * Automatically clears after `clearAfterMs` milliseconds.
 */
export function useTypingIndicator(clearAfterMs = 3000) {
  const [typingAgent, setTypingAgent] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleTyping = useCallback((agentName: string) => {
    setTypingAgent(agentName);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setTypingAgent(null);
      timerRef.current = null;
    }, clearAfterMs);
  }, [clearAfterMs]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { typingAgent, handleTyping };
}
