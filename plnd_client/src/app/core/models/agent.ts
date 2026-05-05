export interface ActionTaken {
  type: string;
  task_id?: string;
  scheduled_at?: string;
  date?: string;            // date the task was scheduled to (YYYY-MM-DD)
  after_anchor?: string;  // meal anchor, e.g. "breakfast"
}

export interface ShowCheckboxSignal {
  type: 'show_checkbox';
  field: string;
  label?: string;
  default?: boolean;
}

export interface ShowSelectSignal {
  type: 'show_select';
  field: string;
  label?: string;
  default?: string;
  options?: string[];
}

export type UiSignal = ShowCheckboxSignal | ShowSelectSignal;

export interface ConversationTurn {
  signals: UiSignal[];
  answers: Record<string, unknown>;
}

export interface TaskEntryRequest {
  input: string;
  date?: string;            // YYYY-MM-DD — the day the user is currently viewing
  context?: ConversationTurn[];
}

export interface TaskEntryResponse {
  actions_taken: ActionTaken[];
  ui_signals: UiSignal[];
  confirmation: string;
}
