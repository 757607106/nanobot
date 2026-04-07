import { createContext, useContext } from 'react'
import type { ColumnsType } from 'antd/es/table'
import type {
  KnowledgeBaseDefinition,
  KnowledgeBenchmark,
  KnowledgeDocument,
  KnowledgeEvaluationResult,
  KnowledgeEvaluationSummary,
  KnowledgeFileListResponse,
  KnowledgeGraphData,
  KnowledgeGraphStats,
  KnowledgeIngestJob,
  KnowledgeMindmapNode,
  KnowledgeQueryParams,
  KnowledgeQueryParamSchema,
  KnowledgeRetrieveResult,
} from '../../types'
import type { KnowledgeFormState, KnowledgeIndexConfigState } from './shared'

// ─── Loading states ───
export interface KnowledgeLoadingState {
  detail: boolean
  query: boolean
  graph: boolean
  mindmap: boolean
  benchmark: boolean
  runningEvaluation: boolean
  parsing: boolean
  indexing: boolean
  saving: boolean
  generatingDescription: boolean
}

// ─── Context shape ───
export interface KnowledgeContextValue {
  // Core data
  currentKb: KnowledgeBaseDefinition | null
  filesState: KnowledgeFileListResponse
  jobs: KnowledgeIngestJob[]
  loading: KnowledgeLoadingState

  // File selection
  selectedFileIds: string[]
  fileSearch: string
  visibleFiles: KnowledgeDocument[]
  selectedFiles: KnowledgeDocument[]
  selectedDocumentIds: string[]
  pendingParseCount: number
  pendingIndexCount: number
  pendingParseFileIds: string[]
  pendingIndexFileIds: string[]
  hasSelectedFiles: boolean
  canParseSelectedDocuments: boolean
  canIndexSelectedDocuments: boolean
  hasSingleSelection: boolean
  parseableSelectedFileIds: string[]
  indexableSelectedFileIds: string[]

  // Query
  queryParams: KnowledgeQueryParams
  queryText: string
  queryResult: KnowledgeRetrieveResult | null
  resultView: 'formatted' | 'raw'
  sampleQuestions: string[]
  queryParamSchema: KnowledgeQueryParamSchema | null

  // Visualization
  mindmap: KnowledgeMindmapNode | null
  graphData: KnowledgeGraphData | null
  graphStats: KnowledgeGraphStats | null
  graphConfig: { label: string; depth: number; maxNodes: number }

  // Benchmark & evaluation
  benchmarks: KnowledgeBenchmark[]
  evaluationHistory: KnowledgeEvaluationSummary[]
  evaluationResult: KnowledgeEvaluationResult | null
  evaluationErrorOnly: boolean
  selectedBenchmarkId: string | null
  benchmarkColumns: ColumnsType<KnowledgeBenchmark>
  evaluationColumns: ColumnsType<KnowledgeEvaluationSummary>

  // Folder options
  folderOptions: { label: string; value: string }[]

  // Form state
  formState: KnowledgeFormState
  indexConfig: KnowledgeIndexConfigState
  embeddingBindingOptions: { value: string; label: string }[]
  llmBindingOptions: { value: string; label: string }[]
  rerankBindingOptions: { value: string; label: string }[]
  multimodalBindingOptions: { value: string; label: string }[]

  // ─── Actions ───
  onFormStateChange: (state: KnowledgeFormState) => void
  onIndexConfigChange: (state: KnowledgeIndexConfigState) => void
  onActiveTabChange: (tab: string) => void

  onFileSearchChange: (value: string) => void
  onSelectedFileIdsChange: (ids: string[]) => void
  onRefreshDetail: () => void
  onDeleteKnowledgeBase: () => void
  onOpenModal: (name: 'folder' | 'url' | 'move' | 'indexConfig' | 'queryConfig' | 'benchmarkGenerate' | 'benchmarkUpload') => void
  onSetUrlParentId: (id: string | null) => void
  onParseSelected: (fileIds?: string[], notifySkipped?: boolean) => void
  onIndexSelected: (fileIds?: string[], notifySkipped?: boolean) => void
  onDeleteSelectedFiles: (files?: KnowledgeDocument[]) => void
  onOpenMoveModal: () => void
  onOpenFileDetail: (file: KnowledgeDocument) => void
  onQueryParamsChange: (params: KnowledgeQueryParams) => void
  onQueryTextChange: (text: string) => void
  onQuery: (query?: string) => void
  onResultViewChange: (view: 'formatted' | 'raw') => void
  onSaveQueryDefaults: () => void
  onGenerateQuestions: () => void
  onGraphConfigChange: (config: { label?: string; depth?: number; maxNodes?: number }) => void
  onReloadGraph: () => void
  onRegenerateMindmap: () => void
  onBenchmarkChange: (id: string | null) => void
  onRunEvaluation: () => void
  onRefreshBenchmarks: () => void
  onViewEvaluationResult: (taskId: string, errorOnly?: boolean) => void
  onDeleteEvaluationResult: (taskId: string) => void
  onOpenBenchmarkGenerate: () => void
  onOpenBenchmarkUpload: () => void
  onSaveKnowledgeBase: () => void
  onGenerateDescription: () => void
}

const KnowledgeContext = createContext<KnowledgeContextValue | null>(null)

export function KnowledgeProvider({ value, children }: { value: KnowledgeContextValue; children: React.ReactNode }) {
  return <KnowledgeContext.Provider value={value}>{children}</KnowledgeContext.Provider>
}

export function useKnowledge(): KnowledgeContextValue {
  const ctx = useContext(KnowledgeContext)
  if (!ctx) {
    throw new Error('useKnowledge must be used within a KnowledgeProvider')
  }
  return ctx
}
