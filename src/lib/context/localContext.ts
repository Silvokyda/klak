import type { LocalContextSnapshot } from "../../types";

export interface LocalContextCollector {
  collect(): Promise<LocalContextSnapshot>;
}

export const localContextCollector: LocalContextCollector = {
  async collect() {
    return {};
  }
};
