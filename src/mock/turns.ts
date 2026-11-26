import type { LogEntry } from '../../api/_lib/types.js'
import type { FeedTurn } from '../lib/burn-rate.js'

const MS_PER_SECOND = 1_000

function turn(
  id: string,
  atMs: number,
  entry: Omit<LogEntry, 'agent_id'> & { agent_id: string },
): FeedTurn {
  return { id, at: atMs, entry }
}

export function mockTurns(now: number): FeedTurn[] {
  const s = MS_PER_SECOND

  const loopEntry: LogEntry = {
    provider: 'opencode_go',
    agent_id: 'loop-agent',
    task_name: 'refactor-auth-flow',
    model: 'glm-4.7',
    input_tokens: 8_000,
    output_tokens: 4_000,
    cache_read_tokens: 6_000,
  }

  return [
    // loop-agent: one turn in each 60s bucket of the 180s loop window, 36k tokens total
    turn('t1', now - 170 * s, { ...loopEntry }),
    turn('t2', now - 90 * s, { ...loopEntry }),
    turn('t3', now - 30 * s, { ...loopEntry }),
    // regular agents with varied model/task/cache
    turn('t4', now - 45 * s, {
      provider: 'claude_code',
      agent_id: 'claude-main',
      task_name: 'write-release-spec',
      model: 'claude-sonnet-4.5',
      input_tokens: 2_500,
      output_tokens: 900,
      cache_read_tokens: 18_000,
    }),
    turn('t5', now - 4 * 60 * s, {
      provider: 'claude_code',
      agent_id: 'claude-main',
      task_name: 'review-pr-42',
      model: 'claude-sonnet-4.5',
      input_tokens: 3_100,
      output_tokens: 1_400,
      cache_read_tokens: 2_400,
    }),
    turn('t6', now - 2 * 60 * s, {
      provider: 'opencode_go',
      agent_id: 'go-helper',
      task_name: 'fix-vite-build',
      model: 'glm-4.7-air',
      input_tokens: 1_200,
      output_tokens: 300,
      cache_read_tokens: 0,
    }),
    turn('t7', now - 12 * s, {
      provider: 'claude_code',
      agent_id: 'docs-bot',
      task_name: 'update-readme',
      model: 'claude-haiku-4.5',
      input_tokens: 800,
      output_tokens: 250,
      cache_read_tokens: 400,
    }),
    turn('t8', now - 75 * s, {
      provider: 'opencode_go',
      agent_id: 'go-helper',
      task_name: 'fix-vite-build',
      model: 'glm-4.7-air',
      input_tokens: 950,
      output_tokens: 420,
      cache_read_tokens: 0,
    }),
  ]
}
