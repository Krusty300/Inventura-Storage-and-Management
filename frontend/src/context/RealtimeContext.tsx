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
  product: ["products", "product", "product-cost", "product-movements", "product-stock-locations", "product-quarantined-lots", "product-quarantined-serials", "product-reserved-serials", "trace", "exceptions", "dashboard", "reports", "forecasting", "mrp", "stock-locations", "global-search", "entity-search"],
  category: ["categories", "category-products", "category-suppliers", "reports", "dashboard"],
  supplier: ["suppliers", "suppliers-lookup", "supplier-products", "supplier-stats", "supplier-orders", "reports", "global-search", "entity-search"],
  stock_movement: ["stock-movements", "product-movements", "trace", "stock-locations", "quarantined-locations", "exceptions", "dashboard", "reports", "mrp"],
  shipment: ["shipments", "shipment", "dashboard", "reports"],
  order: ["orders", "dashboard", "reports", "forecasting"],
  sale: ["sales", "dashboard", "reports", "forecasting"],
  asn: ["asns", "reports"],
  receipt: ["receipts", "dashboard", "reports"],
  user: ["users", "auth-sessions", "assignable-users"],
  activity_log: ["activity-logs"],
  notification: ["notifications"],
  note: ["notes", "notes-kanban", "notes-calendar", "note-tags", "note-templates", "assignable-users"],
  lot: ["lots", "lot-genealogy", "lot-movements", "lot-serials", "exceptions", "dashboard"],
  location: ["locations", "location-detail", "stock-locations", "quarantined-locations", "dashboard"],
  quality_check: ["quality-checks", "exceptions", "dashboard"],
  bom: ["boms", "product-cost", "mrp"],
  customer: ["customers", "customer-stats", "customer-frequent-products", "customer-sales", "reports", "global-search", "entity-search"],
  customer_group: ["customer-groups", "reports"],
  cycle_count: ["cycle-counts", "dashboard"],
  lpn: ["lpns", "lpn", "stock-locations", "quarantined-locations", "dashboard"],
  price_list: ["price-lists"],
  promotion: ["promotions"],
  sales_channel: ["sales-channels"],
  work_order: ["work-orders", "work-orders-kanban", "work-order-cost", "work-order-genealogy", "mrp"],
  serial_number: ["serial-numbers", "serial-movements", "product-reserved-serials", "trace", "exceptions"],
  settings: ["settings"],
  kit: ["kits", "mrp", "product-cost"],
};

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const wsRef = useRef<WebSocket | null>(null);
  const listenersRef = useRef<Set<(msg: RealtimeMessage) => void>>(new Set());
  const [connected, setConnected] = useState(false);
  const retryCountRef = useRef(0);
  const everConnectedRef = useRef(false);
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
        if (everConnectedRef.current) {
          // We missed events while disconnected: refresh only data the user is
          // actually looking at (active, successfully-loaded queries) instead of
          // waking the entire query cache for every mounted screen.
          queryClient.invalidateQueries({
            predicate: (query) =>
              query.state.status === "success" && query.isActive(),
          });
        }
        everConnectedRef.current = true;
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
            localStorage.removeItem("user");
            window.location.href = "/login";
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

    const heartbeatTimer = setInterval(() => {
      const sockWs = wsRef.current;
      if (sockWs && sockWs.readyState === WebSocket.OPEN) {
        sockWs.send("ping");
      }
    }, 30_000);

    connect();

    return () => {
      closed = true;
      clearTimeout(reconnectTimer);
      clearInterval(heartbeatTimer);
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

// eslint-disable-next-line react-refresh/only-export-components
export function useRealtime() {
  return useContext(RealtimeContext);
}
