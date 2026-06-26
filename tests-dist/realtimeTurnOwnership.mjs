function anonymousItemId(turnId) {
  return `anonymous-user-turn-${turnId}`;
}

export class RealtimeTurnOwnership {
  currentTurnId = 0;
  activeUserItemId = null;
  activeResponseId = null;
  userTurns = new Map();
  responses = new Map();
  assistantItems = new Map();

  reset() {
    this.currentTurnId = 0;
    this.activeUserItemId = null;
    this.activeResponseId = null;
    this.userTurns.clear();
    this.responses.clear();
    this.assistantItems.clear();
  }

  beginUserTurn(itemId) {
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

  appendUserTranscript(itemId, delta) {
    const turn = this.getActiveUserTurn(itemId);
    if (!turn) return null;
    turn.partialTranscript += delta;
    return turn.partialTranscript;
  }

  finalizeUserTranscript(itemId, transcript) {
    const turn = this.getActiveUserTurn(itemId);
    if (!turn) return null;
    turn.finalTranscript = transcript || turn.partialTranscript;
    turn.partialTranscript = "";
    return turn.finalTranscript;
  }

  beginResponse(responseId) {
    if (!responseId) return false;
    const existing = this.responses.get(responseId);
    if (existing?.cancelled) return false;
    this.activeResponseId = responseId;
    if (!existing) {
      this.responses.set(responseId, {
        responseId,
        turnId: this.currentTurnId,
        assistantItemId: null,
        outputItemIds: new Set(),
        partialAssistantTranscript: "",
        finalAssistantTranscript: "",
        cancelled: false,
        completed: false
      });
    }
    return true;
  }

  registerResponseOutput(responseId, itemId) {
    const response = this.getActiveResponse(responseId);
    if (!response || !itemId) return false;
    response.outputItemIds.add(itemId);
    this.assistantItems.set(itemId, response.responseId);
    if (!response.assistantItemId) response.assistantItemId = itemId;
    return true;
  }

  appendAssistantTranscript(responseId, itemId, delta) {
    const response = this.getActiveResponse(responseId, itemId);
    if (!response) return null;
    response.partialAssistantTranscript += delta;
    return response.partialAssistantTranscript;
  }

  finalizeAssistantTranscript(responseId, itemId, transcript) {
    const response = this.getActiveResponse(responseId, itemId);
    if (!response) return null;
    response.finalAssistantTranscript = transcript || response.partialAssistantTranscript;
    response.partialAssistantTranscript = "";
    return response.finalAssistantTranscript;
  }

  cancelResponse(responseId) {
    const response = this.getActiveResponse(responseId);
    if (!response) return;
    response.cancelled = true;
    if (this.activeResponseId === response.responseId) {
      this.activeResponseId = null;
    }
  }

  completeResponse(responseId) {
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

  isActiveUserItem(itemId) {
    return Boolean(this.getActiveUserTurn(itemId));
  }

  isActiveResponse(responseId, itemId) {
    return Boolean(this.getActiveResponse(responseId, itemId));
  }

  getCurrentUserPartialTranscript() {
    return this.getCurrentUserTurn()?.partialTranscript ?? "";
  }

  getCurrentUserFinalTranscript() {
    return this.getCurrentUserTurn()?.finalTranscript ?? "";
  }

  getCurrentAssistantPartialTranscript() {
    const response = this.getCurrentResponse();
    return response?.partialAssistantTranscript ?? "";
  }

  getCurrentAssistantFinalTranscript() {
    const response = this.getCurrentResponse();
    return response?.finalAssistantTranscript ?? "";
  }

  getCurrentResponseId() {
    return this.activeResponseId;
  }

  getCurrentUserTurn() {
    if (!this.activeUserItemId) return null;
    return this.userTurns.get(this.activeUserItemId) ?? null;
  }

  getCurrentResponse() {
    if (!this.activeResponseId) return null;
    return this.responses.get(this.activeResponseId) ?? null;
  }

  getActiveUserTurn(itemId) {
    if (itemId) {
      const turn = this.userTurns.get(itemId);
      if (!turn || turn.turnId !== this.currentTurnId) return null;
      return turn;
    }
    const current = this.getCurrentUserTurn();
    if (!current || current.turnId !== this.currentTurnId) return null;
    return current;
  }

  getActiveResponse(responseId, itemId) {
    const resolvedResponseId = responseId || (itemId ? this.assistantItems.get(itemId) ?? null : this.activeResponseId);
    if (!resolvedResponseId) return null;
    const response = this.responses.get(resolvedResponseId) ?? null;
    if (!response || response.turnId !== this.currentTurnId || response.cancelled) return null;
    if (itemId && response.outputItemIds.size > 0 && !response.outputItemIds.has(itemId) && response.assistantItemId !== itemId) {
      return null;
    }
    return response;
  }

  findUserTurnById(turnId) {
    for (const turn of this.userTurns.values()) {
      if (turn.turnId === turnId) return turn;
    }
    return null;
  }
}
