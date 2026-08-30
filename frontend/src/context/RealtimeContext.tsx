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
  sale: ["sales"],
  asn: ["asns"],
  receipt: ["receipts"],
  user: ["users"],
  activity_log: ["activity-logs"],
  notification: ["notifications"],
  note: ["notes", "notes-kanban", "note-tags", "note-templates"],
  lot: ["lots", "lot-genealogy", "exceptions", "dashboard"],
  location: ["locations"],
  quality_check: ["quality-checks", "exceptions", "dashboard"],
  bom: ["boms"],
  customer: ["customers", "customer-stats", "customer-frequent-products", "customer-sales"],
  customer_group: ["customer-groups"],
  cycle_count: ["cycle-counts"],
  lpn: ["lpns", "lpn"],
  price_list: ["price-lists"],
  promotion: ["promotions"],
  sales_channel: ["sales-channels"],
  work_order: ["work-orders"],
  serial_number: ["serial-numbers"],
  settings: ["settings"],
};

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<(msg: RealtimeMessage) => void>>(new Set());
  const [connected, setConnected] = useState(false);
  const retryCountRef = useRef(0);
  const MAX_RECONNECT_DELAY = 30_000;
  const MAX_RECONNECT_ATTEMPTS = 15;

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
      const token = localStorage.getItem("token");
      if (!token) return;
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${protocol}//${location.host}/ws?token=${encodeURIComponent(token)}`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        retryCountRef.current = 0;
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

      ws.onclose = (event) => {
        setConnected(false);
        wsRef.current = null;
        if (!closed) {
          if (event.code === 4001 || event.code === 4003) {
            localStorage.removeItem("token");
            return;
          }
          const attempt = retryCountRef.current;
          if (attempt < MAX_RECONNECT_ATTEMPTS) {
            const delay = Math.min(1000 * Math.pow(2, attempt), MAX_RECONNECT_DELAY);
            retryCountRef.current = attempt + 1;
            reconnectTimer = setTimeout(connect, delay);
          }
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
