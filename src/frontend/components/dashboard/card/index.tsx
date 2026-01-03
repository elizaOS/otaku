import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/frontend/components/ui/card";
import { Bullet } from "@/frontend/components/ui/bullet";

interface DashboardCardProps
  extends Omit<React.ComponentProps<typeof Card>, "title"> {
  title: string;
  subtitle?: string;
  addon?: React.ReactNode;
  intent?: "default" | "success";
  children: React.ReactNode;
}

export default function DashboardCard({
  title,
  subtitle,
  addon,
  intent = "default",
  children,
  className,
  ...props
}: DashboardCardProps) {
  return (
    <Card className={className} {...props}>
      <CardHeader className="flex items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2.5">
            <Bullet variant={intent} />
            {title}
          </CardTitle>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-1 ml-5">{subtitle}</p>
          )}
        </div>
        {addon && <div>{addon}</div>}
      </CardHeader>

      <CardContent className="flex-1 relative">{children}</CardContent>
    </Card>
  );
}
