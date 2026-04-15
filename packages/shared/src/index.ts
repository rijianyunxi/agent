import type OpenAI from 'openai';

export interface Logger {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface Tool {
  definition: OpenAI.ChatCompletionFunctionTool;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

export interface RetrievalCandidate {
  id: string;
  source: string;
  content: string;
}

export interface RetrievalResult {
  candidate: RetrievalCandidate;
  score: number;
}

export interface McpServerConfig {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  enabled?: boolean;
}

export interface McpConfigFile {
  servers?: Record<string, McpServerConfig>;
}

export interface RuntimeMcpServer {
  name: string;
  config: McpServerConfig;
}

export interface AgentInputImageUrl {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export interface AgentInputText {
  type: 'text';
  text: string;
}

export type AgentUserContentPart = AgentInputText | AgentInputImageUrl;

export type MemoryScope = 'user' | 'site' | 'global';

export interface MemoryRecord {
  id: number;
  sessionId: string;
  userId: string | null;
  userSymbol: string | null;
  scope: MemoryScope;
  key: string;
  value: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationLogRecord {
  id: number;
  sessionId: string;
  userId: string | null;
  userSymbol: string | null;
  role: string;
  content: string;
  timestamp: number;
}

export interface AttendanceRecord {
  name: string;
  team: string;
  status: '出勤' | '请假' | '缺勤' | '迟到';
  checkInTime?: string;
  reason?: string;
}

export interface AttendanceSummary {
  date: string;
  totalExpected: number;
  actualPresent: number;
  leave: number;
  absent: number;
  late: number;
  records: AttendanceRecord[];
}

export interface InspectionRecord {
  id: string;
  area: string;
  inspector: string;
  time: string;
  status: '合格' | '不合格' | '待整改';
  issues: string[];
  images?: string[];
}

export interface InspectionSummary {
  date: string;
  totalInspections: number;
  passed: number;
  failed: number;
  pending: number;
  records: InspectionRecord[];
}
