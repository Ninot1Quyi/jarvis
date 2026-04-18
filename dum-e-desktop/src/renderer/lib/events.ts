import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Message, ToolCall } from './types';
import { dumApi } from './api';

// A2A Task state → local event
interface A2ATask {
  id: string;
  state: string; // SUBMITTED, WORKING, COMPLETED, FAILED, CANCELED
  artifacts?: Array<{ parts: Array<{ Text?: { text: string } }> }>;
  history?: Array<{ role: string; parts: Array<{ Text?: { text: string } }> }>;
}

export function useDumEvents() {
  const queryClient = useQueryClient();
  const eventBufferRef = useRef<Map<string, ToolCall>>(new Map());
  const [allEvents, setAllEvents] = useState<unknown[]>([]);

  useEffect(() => {
    // Subscribe to events forwarded from A2A polling
    const unsubscribe = dumApi.onEvent((event) => {
      setAllEvents((prev) => [...prev, event]);

      const e = event as { type: string; task?: A2ATask; error?: string };

      if (e.type === 'TaskUpdate' && e.task) {
        const task = e.task;
        queryClient.setQueryData(['agentStatus'], {
          status: task.state === 'WORKING' ? 'running' :
                  task.state === 'COMPLETED' ? 'idle' :
                  task.state === 'FAILED' ? 'error' : 'idle',
          taskId: task.id,
          state: task.state,
        });

        // Update messages from task history
        if (task.history) {
          const messages: Message[] = task.history.map((msg, i) => ({
            id: `${task.id}-${i}`,
            role: msg.role === 'user' ? 'user' as const : 'assistant' as const,
            content: msg.parts.map((p) => p.Text?.text || '').join(''),
            timestamp: Date.now(),
          }));
          queryClient.setQueryData(['messages'], messages);
        }

        // Update tool calls from artifacts
        if (task.artifacts) {
          task.artifacts.forEach((artifact, i) => {
            const content = artifact.parts.map((p) => p.Text?.text || '').join('');
            if (content.startsWith('[TOOL:')) {
              try {
                const toolData = JSON.parse(content.replace('[TOOL:', '').replace(']', ''));
                const tc: ToolCall = {
                  id: `${task.id}-tool-${i}`,
                  name: toolData.name,
                  input: toolData.input || {},
                  state: task.state === 'WORKING' ? 'running' :
                         task.state === 'COMPLETED' ? 'complete' :
                         task.state === 'FAILED' ? 'error' : 'pending',
                  output: toolData.output,
                };
                eventBufferRef.current.set(tc.id, tc);
              } catch { /* not JSON */ }
            }
          });
          queryClient.setQueryData(['toolCalls'],
            Array.from(eventBufferRef.current.values()));
        }
      }

      if (e.type === 'AgentError') {
        queryClient.setQueryData(['agentStatus'], { status: 'error', error: e.error });
      }
    });

    return () => unsubscribe();
  }, [queryClient]);

  const clearEvents = useCallback(() => setAllEvents([]), []);

  return { events: allEvents, clearEvents };
}

// Hook for sending messages
export function useDumCommands() {
  const sendMessage = useCallback(async (text: string) => {
    return dumApi.send(text);
  }, []);

  const stop = useCallback(async () => {
    return dumApi.stopAgent();
  }, []);

  const regenerate = useCallback(async () => undefined, []);

  return { sendMessage, stop, regenerate };
}
