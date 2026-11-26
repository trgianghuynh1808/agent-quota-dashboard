import { describe, expect, it } from 'vitest'
import {
  detectLoops,
  toAgentSample,
  type AgentTokenSample,
} from '../src/lib/anomaly.js'

const NOW = 1_000_000

function sample(agentId: string, at: number, tokens: number): AgentTokenSample {
  return { agentId, at, tokens }
}

describe('T1 loop detection', () => {
  it('flags an agent that burns tokens across all 3 buckets above threshold', () => {
    const samples = [
      sample('a', NOW - 150_000, 12_000),
      sample('a', NOW - 90_000, 12_000),
      sample('a', NOW - 30_000, 12_000),
    ]

    const alerts = detectLoops(samples, NOW)

    expect(alerts).toHaveLength(1)
    expect(alerts[0]).toMatchObject({
      agentId: 'a',
      totalTokens: 36_000,
      turns: 3,
      tpm: 12_000,
    })
  })
})

describe('T2 no false positives', () => {
  it('ignores lumped burn, sub-threshold burn and out-of-window samples', () => {
    const samples = [
      sample('b', NOW - 10_000, 40_000),
      sample('c', NOW - 150_000, 1_000),
      sample('c', NOW - 90_000, 1_000),
      sample('c', NOW - 30_000, 1_000),
      sample('d', NOW - 200_000, 1),
      sample('d', NOW - 90_000, 20_000),
      sample('d', NOW - 30_000, 20_000),
    ]

    expect(detectLoops(samples, NOW)).toEqual([])
  })
})

describe('T3 multiple agents, override and toAgentSample', () => {
  it('sorts by total tokens, splits per agent and honours minTokens', () => {
    const samples = [
      sample('x', NOW - 150_000, 12_000),
      sample('x', NOW - 90_000, 12_000),
      sample('x', NOW - 30_000, 12_000),
      sample('y', NOW - 150_000, 20_000),
      sample('y', NOW - 90_000, 20_000),
      sample('y', NOW - 30_000, 20_000),
    ]

    expect(detectLoops(samples, NOW).map((a) => a.agentId)).toEqual(['y', 'x'])
    expect(
      detectLoops(samples, NOW, { minTokens: 50_000 }).map((a) => a.agentId),
    ).toEqual(['y'])

    expect(
      toAgentSample({ agent_id: 'x', input_tokens: 100, output_tokens: 50 }, 5),
    ).toEqual({ agentId: 'x', at: 5, tokens: 150 })
  })
})
