/**
 * Terminal Component
 * 
 * Wrapper for ghostty-web terminal emulator with WebSocket connection
 * via PartySocket WebSocket.
 * 
 * Features:
 * - Auto-reconnection on network changes (critical for mobile)
 * - Message buffering during brief disconnects
 * - Debounced resize event handling with ResizeObserver
 * - Full-height terminal that fills parent container
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { init, Terminal as GhosttyTerminal } from "ghostty-web";
import { WebSocket as PartyWebSocket } from "partysocket";
import { Loader2, WifiOff } from "lucide-react";
import { getWebSocketBaseUrl } from "@/lib/api";

interface TerminalProps {
  vmId: string;
}

// Connection states
type ConnectionState = "connecting" | "open" | "closing" | "closed";

// Debounce helper
function debounce<T extends (...args: Parameters<T>) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

export function Terminal({ vmId }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<GhosttyTerminal | null>(null);
  const wsRef = useRef<PartyWebSocket | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);
  const [connectionState, setConnectionState] = useState<ConnectionState>("connecting");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const pendingInputRef = useRef<string>("");
  const isUnmountingRef = useRef(false);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const readyReceivedRef = useRef(false);
  const dataReceivedAfterReadyRef = useRef(false);

  // Determine WebSocket URL - connect directly to API server
  const wsUrl = `${getWebSocketBaseUrl()}/api/vms/${vmId}/terminal`;

  // Send data to WebSocket
  const sendData = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    } else {
      // Buffer input during disconnect
      pendingInputRef.current += data;
      // Keep only last 1000 chars
      if (pendingInputRef.current.length > 1000) {
        pendingInputRef.current = pendingInputRef.current.slice(-1000);
      }
    }
  }, []);

  // Handle terminal resize - send to backend in expected format
  // Backend expects: {"resize": {"cols": X, "rows": Y}}
  const handleResize = useCallback(({ cols, rows }: { cols: number; rows: number }) => {
    // Skip if size hasn't changed
    if (lastSizeRef.current?.cols === cols && lastSizeRef.current?.rows === rows) {
      return;
    }
    lastSizeRef.current = { cols, rows };
    
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          resize: { cols, rows },
        })
      );
    }
  }, []);

  // Initialize WebSocket connection
  useEffect(() => {
    isUnmountingRef.current = false;
    
    const ws = new PartyWebSocket(wsUrl, [], {
      maxRetries: 10,
      minReconnectionDelay: 1000,
      maxReconnectionDelay: 10000,
      reconnectionDelayGrowFactor: 1.3,
      connectionTimeout: 4000,
      maxEnqueuedMessages: 100,
    });

    ws.addEventListener("open", () => {
      if (isUnmountingRef.current) return;
      setConnectionState("open");
      setConnectionError(null); // Clear any previous errors
      console.log("[Terminal] WebSocket connected");
      
      // Send any pending input
      if (pendingInputRef.current) {
        ws.send(pendingInputRef.current);
        pendingInputRef.current = "";
      }
    });

    ws.addEventListener("message", (e: MessageEvent) => {
      if (isUnmountingRef.current) return;
      
      // Check if message is a JSON control message from the server
      const data = e.data;
      if (typeof data === "string" && data.startsWith("{")) {
        try {
          const msg = JSON.parse(data);
          
          // Handle ready message - mark that we're ready for data
          if (msg.ready) {
            console.log("[Terminal] Connection ready");
            readyReceivedRef.current = true;
            dataReceivedAfterReadyRef.current = false;
            // Clear the terminal to start fresh - clear screen, scrollback, and reset
            if (terminalRef.current) {
              terminalRef.current.write("\x1bc\x1b[2J\x1b[3J\x1b[H"); // Reset terminal, clear screen, clear scrollback, home cursor
            }
            return;
          }
          
          // Handle error messages - show in UI instead of terminal
          if (msg.error) {
            console.error("[Terminal] Server error:", msg.error);
            setConnectionError(msg.error);
            return;
          }
        } catch {
          // Not valid JSON, treat as terminal output
        }
      }
      
      // Write terminal output - only after ready to avoid stale data
      if (terminalRef.current && readyReceivedRef.current) {
        dataReceivedAfterReadyRef.current = true;
        terminalRef.current.write(data);
      }
    });

    ws.addEventListener("close", () => {
      if (isUnmountingRef.current) return;
      setConnectionState("closed");
      console.log("[Terminal] WebSocket disconnected");
    });

    ws.addEventListener("error", (e: Event) => {
      if (isUnmountingRef.current) return;
      console.error("[Terminal] WebSocket error:", e);
    });

    wsRef.current = ws;

    return () => {
      isUnmountingRef.current = true;
      ws.close();
      wsRef.current = null;
    };
  }, [wsUrl]);

  // Initialize ghostty-web terminal
  useEffect(() => {
    let isMounted = true;
    let resizeObserver: ResizeObserver | null = null;

    const initTerminal = async () => {
      try {
        await init();
        
        if (!isMounted || !containerRef.current) return;

        // Calculate font size based on viewport
        const fontSize = window.innerWidth < 640 ? 12 : 14;
        
        // Character dimensions (approximate for monospace font)
        // These need to match the actual rendered font metrics
        const charWidth = fontSize * 0.6;  // Approximate character width ratio
        const charHeight = fontSize * 1.2; // Approximate line height ratio

        const terminal = new GhosttyTerminal({
          fontSize,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          theme: {
            background: "#1a1b26",
            foreground: "#a9b1d6",
            cursor: "#a9b1d6",
            selectionBackground: "#283457",
            black: "#32344a",
            red: "#f7768e",
            green: "#9ece6a",
            yellow: "#e0af68",
            blue: "#7aa2f7",
            magenta: "#bb9af7",
            cyan: "#7dcfff",
            white: "#787c99",
            brightBlack: "#444b6a",
            brightRed: "#ff7a93",
            brightGreen: "#b9f27c",
            brightYellow: "#ff9e64",
            brightBlue: "#7da6ff",
            brightMagenta: "#bb9af7",
            brightCyan: "#0db9d7",
            brightWhite: "#acb0d0",
          },
          cursorBlink: true,
          cursorStyle: "block",
          scrollback: 10000,
        });

        terminal.open(containerRef.current);
        terminal.onData(sendData);
        terminal.onResize(handleResize);

        // Fit terminal to container with proper calculations
        const fitTerminal = () => {
          if (!containerRef.current || !terminal) return;
          
          const rect = containerRef.current.getBoundingClientRect();
          // Account for any padding/border in the container
          const availableWidth = rect.width;
          const availableHeight = rect.height;
          
          // Calculate cols and rows based on character dimensions
          const cols = Math.max(1, Math.floor(availableWidth / charWidth));
          const rows = Math.max(1, Math.floor(availableHeight / charHeight));
          
          terminal.resize(cols, rows);
        };

        // Debounced version for resize events to prevent excessive updates
        const debouncedFitTerminal = debounce(fitTerminal, 100);

        // Use ResizeObserver for more reliable container size tracking
        resizeObserver = new ResizeObserver(() => {
          debouncedFitTerminal();
        });
        resizeObserver.observe(containerRef.current);

        // Initial fit
        fitTerminal();

        terminalRef.current = terminal;
        setIsInitialized(true);

        // Focus terminal after a short delay
        setTimeout(() => {
          terminal.focus();
        }, 100);
      } catch (error) {
        console.error("[Terminal] Failed to initialize:", error);
      }
    };

    initTerminal();

    return () => {
      isMounted = false;
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
      if (terminalRef.current) {
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
    };
  }, [sendData, handleResize]);

  // Get connection status message
  const getStatusMessage = () => {
    // Show error if we have one
    if (connectionError) {
      return connectionError;
    }
    
    switch (connectionState) {
      case "connecting":
        return "Connecting...";
      case "closed":
        return "Disconnected - Reconnecting...";
      case "closing":
        return "Disconnecting...";
      default:
        return null;
    }
  };

  const statusMessage = getStatusMessage();
  const isError = !!connectionError;

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-md border border-border bg-[#1a1b26]">
      {/* Connection status/error overlay */}
      {statusMessage && (
        <div className={`absolute left-0 right-0 top-0 z-10 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium ${
          isError 
            ? "bg-red-500/90 text-white" 
            : "bg-yellow-500/90 text-yellow-950"
        }`}>
          <WifiOff className="size-4" />
          {statusMessage}
        </div>
      )}

      {/* Terminal container - ensure canvas fills available space */}
      <div
        ref={containerRef}
        className="h-full w-full flex-1 overflow-hidden [&_canvas]:!h-full [&_canvas]:!w-full"
        data-testid="terminal-container"
      />

      {/* Loading state */}
      {!isInitialized && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#1a1b26]">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
          <p className="mt-2 text-sm text-muted-foreground">Loading terminal...</p>
        </div>
      )}
    </div>
  );
}

export default Terminal;
