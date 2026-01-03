import React from "react";
import { Badge } from "@/frontend/components/ui/badge";
import { Button } from "@/frontend/components/ui/button";
import { cn } from "@/frontend/lib/utils";
import type { Notification } from "@/frontend/types/dashboard";

interface NotificationItemProps {
  notification: Notification;
  onMarkAsRead: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function NotificationItem({
  notification,
  onMarkAsRead,
  onDelete,
}: NotificationItemProps) {
  const formatTimestamp = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);

    if (minutes < 60) {
      return `${minutes}m ago`;
    } else if (hours < 24) {
      return `${hours}h ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const getTypeColor = (type: Notification["type"]) => {
    switch (type) {
      case "success":
        return "bg-green-500";
      case "warning":
        return "bg-yellow-500";
      case "error":
        return "bg-red-500";
      default:
        return "bg-blue-500";
    }
  };

  const getPriorityBadge = (priority: Notification["priority"]) => {
    switch (priority) {
      case "high":
        return (
          <Badge variant="destructive" className="text-xs">
            HIGH
          </Badge>
        );
      case "medium":
        return (
          <Badge variant="secondary" className="text-xs">
            MED
          </Badge>
        );
      default:
        return null;
    }
  };

  const handleNotificationClick = () => {
    if (!notification.read) {
      onMarkAsRead(notification.id);
    }
  };

  const handleClearClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onDelete(notification.id);
  };

  return (
    <div
      className={cn(
        "group p-3 rounded-lg border transition-all duration-200 hover:shadow-sm",
        !notification.read && "cursor-pointer",
        notification.read
          ? "bg-background/50 border-border/30"
          : "bg-background border-border shadow-sm"
      )}
      onClick={handleNotificationClick}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "w-2 h-2 rounded-full mt-2 shrink-0",
            getTypeColor(notification.type)
          )}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2 mb-1">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <h4
                    className={cn(
                      "text-sm font-medium truncate",
                      !notification.read && "font-semibold"
                    )}
                  >
                    {notification.title}
                  </h4>
                  {getPriorityBadge(notification.priority)}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClearClick}
                  className="opacity-0 group-hover:opacity-100 transition-opacity text-xs h-6 px-2 text-muted-foreground hover:text-destructive shrink-0"
                >
                  clear
                </Button>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2">
                {notification.message}
              </p>
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-muted-foreground">
                  {formatTimestamp(notification.timestamp)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
