import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";

export interface RealtimeMessage {
  event: string;
  entity: string;
  action: string;
}

interface RealtimeContextType {
  connected: boolean;
  subscribe: (listener: (msg: RealtimeMessage) => void) => () => void;
}

const RealtimeContext = createContext<RealtimeContextType>({ connected: false, subscribe: () => () => {} });

const entityQueryMap: Record<string, string[]> = {
  product: ["products"],
  category: ["categories"],
  supplier: ["suppliers"],
  stock_movement: ["stock-movements", "product-movements"],
  shipment: ["shipments", "shipment"],
  order: ["orders"],
  user: ["users"],
  activity_log: ["activity-logs"],
  notification: ["notifications"],
};

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<(msg: RealtimeMessage) => void>>(new Set());
  const [connected, setConnected] = useState(false);

  const subscribe = useCallback((listener: (msg: RealtimeMessage) => void) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;
    let closed = false;

    function connect() {
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${location.host}/ws`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as RealtimeMessage;
          listenersRef.current.forEach((listener) => listener(msg));
          if (msg.event === "entity_changed") {
            const keys = entityQueryMap[msg.entity];
            if (keys) {
              keys.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
            }
          }
        } catch { /* ignore */ }
      };

      ws.onclose = () => {
        setConnected(false);
        wsRef.current = null;
        if (!closed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, [queryClient]);

  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);

  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}

export function useRealtime() {
  return useContext(RealtimeContext);
}
