"use client";

import React, { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Badge } from "@/frontend/components/ui/badge";
import { Bullet } from "@/frontend/components/ui/bullet";
import BellIcon from "@/frontend/components/icons/bell";
import PlusIcon from "@/frontend/components/icons/plus";
import MinusIcon from "@/frontend/components/icons/minus";

const CONTENT_HEIGHT = 400; // Height of expandable content

export default function CollapsibleNotifications() {
  const [isExpanded, setIsExpanded] = useState(false);
  const unreadCount = 0; // Dummy data - will be dynamic later

  const toggleExpanded = () => {
    setIsExpanded(!isExpanded);
  };

  return (
    <motion.div
      className="absolute bottom-0 inset-x-0 z-30"
      initial={{ y: CONTENT_HEIGHT }}
      animate={{ y: isExpanded ? 0 : CONTENT_HEIGHT }}
      transition={{ duration: 0.3, ease: "circInOut" }}
    >
      {/* Header - Matches ChatHeader style exactly */}
      <motion.div
        layout
        className="cursor-pointer flex items-center gap-3 transition-all duration-300 w-full h-14 bg-background text-foreground rounded-t-lg px-4 py-3"
        onClick={toggleExpanded}
      >
        {/* Header Content */}
        <motion.div layout className="flex items-center gap-2 flex-1">
          {/* Unread Badge/Bullet */}
          {unreadCount > 0 ? <Badge>{unreadCount}</Badge> : <Bullet />}
          
          {/* Title */}
          <span className="text-sm font-medium uppercase">
            {isExpanded ? "Notifications" : "Notifications"}
          </span>
        </motion.div>

        {/* Toggle Icon */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.div
            key={isExpanded ? "expanded" : "collapsed"}
            initial={{ opacity: 0, scale: 0.8, rotate: -90 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 0.8, rotate: 90 }}
          >
            {isExpanded ? (
              <MinusIcon className="size-4" />
            ) : (
              <PlusIcon className="size-4" />
            )}
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* Expandable Content - Matches Chat component exactly */}
      <div className="overflow-y-auto" style={{ height: CONTENT_HEIGHT }}>
        <div className="bg-background text-foreground h-full">
          <AnimatePresence mode="wait">
            {isExpanded && (
              <motion.div
                key="expanded"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="h-full flex flex-col"
              >
                {/* Notifications List */}
                <div className="flex-1 flex flex-col overflow-y-auto">
                  {/* Dummy content - Empty state */}
                  <div className="flex flex-col items-center justify-center h-full text-center p-4">
                    <div className="rounded-full bg-muted p-4 mb-4">
                      <BellIcon className="size-8 text-muted-foreground" />
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">
                      No new notifications
                    </p>
                    <p className="text-xs text-muted-foreground/70">
                      You're all caught up!
                    </p>
                  </div>
                  
                  {/* Future: Notification items will go here */}
                  {/* Example structure when there are notifications:
                  <div className="space-y-2 p-3">
                    <NotificationItem ... />
                  </div>
                  */}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

