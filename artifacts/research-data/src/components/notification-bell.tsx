import { Bell, CheckCheck } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTranslation } from "react-i18next";
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead } from "@/hooks/use-notifications";

export function NotificationBell() {
  const { t } = useTranslation();
  const { data } = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  const unread = data?.unread ?? 0;
  const items = data?.notifications ?? [];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="h-11 w-11 text-muted-foreground relative" title={t("notifications.title")}>
          <Bell className="h-5 w-5" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-h-96 overflow-y-auto">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-semibold">{t("notifications.title")}</span>
          {unread > 0 && (
            <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={() => markAll.mutate()}>
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              {t("notifications.markAll")}
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">{t("notifications.empty")}</div>
        ) : (
          items.map((n) => (
            <DropdownMenuItem
              key={n.id}
              className="flex flex-col items-start gap-0.5 whitespace-normal"
              onClick={() => {
                if (!n.read) markRead.mutate(n.id);
              }}
            >
              {n.link ? (
                <Link href={n.link} className="w-full">
                  <NotificationRow n={n} />
                </Link>
              ) : (
                <NotificationRow n={n} />
              )}
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function NotificationRow({ n }: { n: { title: string; body: string; read: boolean; createdAt: string } }) {
  return (
    <div className="w-full">
      <div className="flex items-center gap-2">
        <span className={`text-sm font-medium ${n.read ? "text-muted-foreground" : ""}`}>{n.title}</span>
        {!n.read && <Badge variant="default" className="h-1.5 w-1.5 rounded-full p-0" />}
      </div>
      {n.body && <p className="text-xs text-muted-foreground line-clamp-2">{n.body}</p>}
      <p className="text-[10px] text-muted-foreground">{new Date(n.createdAt).toLocaleString()}</p>
    </div>
  );
}
