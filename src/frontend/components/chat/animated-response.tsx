import * as React from 'react';
import { Response } from './response';

interface AnimatedResponseProps {
  children: string;
  className?: string;
  shouldAnimate?: boolean;
  messageId?: string;
  maxDurationMs?: number;
  onTextUpdate?: () => void;
}

export const AnimatedResponse: React.FC<AnimatedResponseProps> = ({
  children,
  className,
  shouldAnimate = false,
  messageId,
  maxDurationMs = 10000,
  onTextUpdate,
}) => {
  const [visibleText, setVisibleText] = React.useState(shouldAnimate ? '' : children);

  React.useEffect(() => {
    if (!shouldAnimate || !children.trim()) {
      setVisibleText(children);
      return;
    }

    const safeDuration = Math.max(1000, maxDurationMs);

    setVisibleText('');

    const TYPING_INTERVAL = 20;
    const totalChars = children.length;
    const totalSteps = Math.ceil(safeDuration / TYPING_INTERVAL);
    const charsPerStep = Math.max(1, Math.ceil(totalChars / totalSteps));

    let visibleCharCount = 0;
    const interval = setInterval(() => {
      visibleCharCount += charsPerStep;
      if (visibleCharCount >= totalChars) {
        setVisibleText(children);
        clearInterval(interval);
      } else {
        setVisibleText(children.slice(0, visibleCharCount));
      }
      // Notify parent that text was updated so it can handle scrolling
      onTextUpdate?.();
    }, TYPING_INTERVAL);

    return () => clearInterval(interval);
  }, [children, shouldAnimate, messageId, maxDurationMs, onTextUpdate]);

  return (
    <Response className={className}>
      {visibleText}
    </Response>
  );
};

