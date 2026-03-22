import { describe, expect, it } from 'vitest'
import {
  buildKnowledgeAdditionalParams,
  type KnowledgeFormState,
  type KnowledgeIndexConfigState,
} from './shared'

function makeFormState(overrides: Partial<KnowledgeFormState> = {}): KnowledgeFormState {
  return {
    name: '知识库',
    description: '',
    enabled: true,
    embedModelName: '',
    llmModelName: '',
    language: 'Chinese',
    chunkPresetId: 'general',
    autoGenerateQuestions: false,
    qaSeparator: '',
    tagsText: '',
    ...overrides,
  }
}

function makeIndexConfig(overrides: Partial<KnowledgeIndexConfigState> = {}): KnowledgeIndexConfigState {
  return {
    chunkSize: 1000,
    chunkOverlap: 200,
    chunkPresetId: 'general',
    qaSeparator: '',
    ...overrides,
  }
}

describe('buildKnowledgeAdditionalParams', () => {
  it('preserves unknown keys while updating knowledge-base defaults', () => {
    const result = buildKnowledgeAdditionalParams(
      {
        custom_flag: true,
        qa_separator: 'old-separator',
      },
      makeFormState({
        language: 'English',
        chunkPresetId: 'qa',
        autoGenerateQuestions: true,
        qaSeparator: '---FAQ---',
      }),
      makeIndexConfig({
        chunkSize: 400,
        chunkOverlap: 80,
      }),
    )

    expect(result).toMatchObject({
      custom_flag: true,
      language: 'English',
      chunk_preset_id: 'qa',
      chunk_size: 400,
      chunk_overlap: 80,
      auto_generate_questions: true,
      qa_separator: '---FAQ---',
    })
  })

  it('drops blank qa separators and clamps overlap to chunk size', () => {
    const result = buildKnowledgeAdditionalParams(
      {
        qa_separator: 'legacy',
      },
      makeFormState({
        qaSeparator: '   ',
      }),
      makeIndexConfig({
        chunkSize: 300,
        chunkOverlap: 999,
      }),
    )

    expect(result.chunk_size).toBe(300)
    expect(result.chunk_overlap).toBe(299)
    expect(result).not.toHaveProperty('qa_separator')
  })
})
