export interface CompletedRealtimeTurn {
  userTranscript: string;
  assistantTranscript: string;
}

interface UserTurnRecord {
  turnId: number;
  itemId: string;
  partialTranscript: string;
  finalTranscript: string;
  delivered: boolean;
}

interface ResponseRecord {
  responseId: string;
  turnId: number;
  assistantItemId: string | null;
  outputItemIds: Set<string>;
  partialAssistantTranscript: string;
  finalAssistantTranscript: string;
  cancelled: boolean;
  completed: boolean;
}

function anonymousItemId(turnId: number) {
  return `anonymous-user-turn-${turnId}`;
}

export class RealtimeTurnOwnership {
  private currentTurnId = 0;
  private activeUserItemId: string | null = null;
  private activeResponseId: string | null = null;
  private userTurns = new Map<string, UserTurnRecord>();
  private responses = new Map<string, ResponseRecord>();
  private assistantItems = new Map<string, string>();

  reset(): void {
    this.currentTurnId = 0;
    this.activeUserItemId = null;
    this.activeResponseId = null;
    this.userTurns.clear();
    this.responses.clear();
    this.assistantItems.clear();
  }

  beginUserTurn(itemId?: string): boolean {
    const nextTurnId = this.currentTurnId + 1;
    const nextItemId = itemId || anonymousItemId(nextTurnId);
    if (nextItemId === this.activeUserItemId) return false;

    this.currentTurnId = nextTurnId;
    this.activeUserItemId = nextItemId;
    this.activeResponseId = null;
    this.userTurns.set(nextItemId, {
      turnId: nextTurnId,
      itemId: nextItemId,
      partialTranscript: "",
      finalTranscript: "",
      delivered: false
    });
    return true;
  }

  appendUserTranscript(itemId: string | undefined, delta: string): string | null {
    const turn = this.getActiveUserTurn(itemId);
    if (!turn) return null;
    turn.partialTranscript += delta;
    return turn.partialTranscript;
  }

  finalizeUserTranscript(itemId: string | undefined, transcript: string): string | null {
    const turn = this.getActiveUserTurn(itemId);
    if (!turn) return null;
    turn.finalTranscript = transcript || turn.partialTranscript;
    turn.partialTranscript = "";
    return turn.finalTranscript;
  }

  beginResponse(responseId?: string): boolean {
    if (!responseId) return false;
    const existing = this.responses.get(responseId);
    if (existing?.cancelled) return false;
    this.activeResponseId = responseId;
    if (!existing) {
      this.responses.set(responseId, {
        responseId,
        turnId: this.currentTurnId,
        assistantItemId: null,
        outputItemIds: new Set<string>(),
        partialAssistantTranscript: "",
        finalAssistantTranscript: "",
        cancelled: false,
        completed: false
      });
    }
    return true;
  }

  registerResponseOutput(responseId: string | undefined, itemId: string | undefined): boolean {
    const response = this.getActiveResponse(responseId);
    if (!response || !itemId) return false;
    response.outputItemIds.add(itemId);
    this.assistantItems.set(itemId, response.responseId);
    if (!response.assistantItemId) {
      response.assistantItemId = itemId;
    }
    return true;
  }

  appendAssistantTranscript(responseId: string | undefined, itemId: string | undefined, delta: string): string | null {
    const response = this.getActiveResponse(responseId, itemId);
    if (!response) return null;
    response.partialAssistantTranscript += delta;
    return response.partialAssistantTranscript;
  }

  finalizeAssistantTranscript(responseId: string | undefined, itemId: string | undefined, transcript: string): string | null {
    const response = this.getActiveResponse(responseId, itemId);
    if (!response) return null;
    response.finalAssistantTranscript = transcript || response.partialAssistantTranscript;
    response.partialAssistantTranscript = "";
    return response.finalAssistantTranscript;
  }

  cancelResponse(responseId?: string): void {
    const response = this.getActiveResponse(responseId);
    if (!response) return;
    response.cancelled = true;
    if (this.activeResponseId === response.responseId) {
      this.activeResponseId = null;
    }
  }

  completeResponse(responseId?: string): CompletedRealtimeTurn | null {
    const response = this.getActiveResponse(responseId);
    if (!response || response.cancelled || response.completed) return null;
    response.completed = true;
    if (this.activeResponseId === response.responseId) {
      this.activeResponseId = null;
    }

    const userTurn = this.findUserTurnById(response.turnId);
    const userTranscript = userTurn && !userTurn.delivered ? userTurn.finalTranscript.trim() : "";
    if (userTurn && userTranscript) {
      userTurn.delivered = true;
    }

    const assistantTranscript = (response.finalAssistantTranscript || response.partialAssistantTranscript).trim();
    return {
      userTranscript,
      assistantTranscript
    };
  }

  isActiveUserItem(itemId?: string): boolean {
    return Boolean(this.getActiveUserTurn(itemId));
  }

  isActiveResponse(responseId?: string, itemId?: string): boolean {
    return Boolean(this.getActiveResponse(responseId, itemId));
  }

  getCurrentUserPartialTranscript(): string {
    return this.getCurrentUserTurn()?.partialTranscript ?? "";
  }

  getCurrentUserFinalTranscript(): string {
    return this.getCurrentUserTurn()?.finalTranscript ?? "";
  }

  getCurrentAssistantPartialTranscript(): string {
    const response = this.getCurrentResponse();
    return response?.partialAssistantTranscript ?? "";
  }

  getCurrentAssistantFinalTranscript(): string {
    const response = this.getCurrentResponse();
    return response?.finalAssistantTranscript ?? "";
  }

  getCurrentResponseId(): string | null {
    return this.activeResponseId;
  }

  private getCurrentUserTurn(): UserTurnRecord | null {
    if (!this.activeUserItemId) return null;
    return this.userTurns.get(this.activeUserItemId) ?? null;
  }

  private getCurrentResponse(): ResponseRecord | null {
    if (!this.activeResponseId) return null;
    return this.responses.get(this.activeResponseId) ?? null;
  }

  private getActiveUserTurn(itemId?: string): UserTurnRecord | null {
    if (itemId) {
      const turn = this.userTurns.get(itemId);
      if (!turn || turn.turnId !== this.currentTurnId) return null;
      return turn;
    }
    const current = this.getCurrentUserTurn();
    if (!current || current.turnId !== this.currentTurnId) return null;
    return current;
  }

  private getActiveResponse(responseId?: string, itemId?: string): ResponseRecord | null {
    const resolvedResponseId = responseId || (itemId ? this.assistantItems.get(itemId) ?? null : this.activeResponseId);
    if (!resolvedResponseId) return null;
    const response = this.responses.get(resolvedResponseId) ?? null;
    if (!response || response.turnId !== this.currentTurnId || response.cancelled) return null;
    if (itemId && response.outputItemIds.size > 0 && !response.outputItemIds.has(itemId) && response.assistantItemId !== itemId) {
      return null;
    }
    return response;
  }

  private findUserTurnById(turnId: number): UserTurnRecord | null {
    for (const turn of this.userTurns.values()) {
      if (turn.turnId === turnId) return turn;
    }
    return null;
  }
}
