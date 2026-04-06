export interface ActionTaken {
  type: string;
  task_id?: string;
  scheduled_at?: string;
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
  context?: ConversationTurn[];
}

export interface TaskEntryResponse {
  actions_taken: ActionTaken[];
  ui_signals: UiSignal[];
  confirmation: string;
}
