import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

interface NotificationsResponse {
  notifications: Array<{
    id: number;
    userId: number;
    type: string;
    title: string;
    body: string;
    link: string | null;
    read: boolean;
    createdAt: string;
  }>;
  total: number;
  unread: number;
}

async function fetchNotifications(): Promise<NotificationsResponse> {
  const res = await fetch("/api/notifications", { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load notifications");
  return res.json();
}

export function useNotifications() {
  return useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
    refetchInterval: 30_000,
  });
}

export function useMarkNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/notifications/${id}/read`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}

export function useMarkAllNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/notifications/read-all`, { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
}
