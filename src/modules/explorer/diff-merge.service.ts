import { Injectable } from '@nestjs/common';
import { FlowStep, TestAction, TestAssertion } from '../../common/types';
import { FlowDiff, StepDiff } from './types/explorer.types';

@Injectable()
export class DiffMergeService {
  computeDiff(generated: FlowStep[], existing: FlowStep[]): FlowDiff {
    const alignment = this.alignSteps(generated, existing);
    const addedSteps: FlowStep[] = [];
    const removedSteps: FlowStep[] = [];
    const changedSteps: StepDiff[] = [];
    const unchangedStepNumbers: number[] = [];

    // Steps in generated but not aligned to existing
    for (const gen of generated) {
      if (!alignment.has(gen.step)) {
        addedSteps.push(gen);
      }
    }

    // Steps in existing but not aligned to generated
    const alignedExistingSteps = new Set(alignment.values());
    for (const ex of existing) {
      if (!alignedExistingSteps.has(ex.step)) {
        removedSteps.push(ex);
      }
    }

    // Aligned steps: check for changes
    for (const [genStep, exStep] of alignment.entries()) {
      const genFlow = generated.find(s => s.step === genStep);
      const exFlow = existing.find(s => s.step === exStep);
      if (!genFlow || !exFlow) continue;

      const diff = this.diffStep(genFlow, exFlow);
      if (diff) {
        changedSteps.push(diff);
      } else {
        unchangedStepNumbers.push(exStep);
      }
    }

    return { addedSteps, removedSteps, changedSteps, unchangedStepNumbers };
  }

  mergeFlows(
    generated: FlowStep[],
    existing: FlowStep[],
    strategy: 'prefer_existing' | 'prefer_generated'
  ): FlowStep[] {
    if (strategy === 'prefer_generated') {
      // Replace flow entirely but keep notes from existing steps
      return generated.map(gen => {
        const match = existing.find(ex =>
          this.nameSimilarity(gen.name, ex.name) > 0.6 ||
          (gen.url && ex.url && gen.url === ex.url)
        );
        if (match?.notes) {
          return { ...gen, notes: match.notes };
        }
        return gen;
      });
    }

    // prefer_existing: keep existing steps, insert newly discovered ones
    // Clone elements to avoid mutating the caller's array
    const result = existing.map(s => ({ ...s }));
    const alignment = this.alignSteps(generated, existing);

    for (const gen of generated) {
      if (!alignment.has(gen.step)) {
        // New step not in existing — insert at appropriate position
        const insertIdx = this.findInsertPosition(gen, result);
        const reNumbered = { ...gen, step: insertIdx + 1 };
        result.splice(insertIdx, 0, reNumbered);
        // Re-number all steps after insertion
        result.forEach((s, i) => { s.step = i + 1; });
      }
    }

    return result;
  }

  private alignSteps(
    generated: FlowStep[],
    existing: FlowStep[]
  ): Map<number, number> {
    const alignment = new Map<number, number>();
    const usedExisting = new Set<number>();

    for (const gen of generated) {
      let bestMatch: FlowStep | null = null;
      let bestScore = 0;

      for (const ex of existing) {
        if (usedExisting.has(ex.step)) continue;

        let score = 0;

        // Name similarity
        score += this.nameSimilarity(gen.name, ex.name) * 0.6;

        // URL match
        if (gen.url && ex.url && gen.url === ex.url) score += 0.3;

        // Phase match
        if (gen.phase && ex.phase && gen.phase === ex.phase) score += 0.1;

        if (score > bestScore) {
          bestScore = score;
          bestMatch = ex;
        }
      }

      if (bestMatch && bestScore >= 0.4) {
        alignment.set(gen.step, bestMatch.step);
        usedExisting.add(bestMatch.step);
      }
    }

    return alignment;
  }

  private diffStep(generated: FlowStep, existing: FlowStep): StepDiff | null {
    const actionDiff = this.diffActions(generated.actions, existing.actions);
    const assertionDiff = this.diffAssertions(generated.assertions, existing.assertions);

    const hasChanges =
      actionDiff.added.length > 0 ||
      actionDiff.removed.length > 0 ||
      actionDiff.changed.length > 0 ||
      assertionDiff.added.length > 0 ||
      assertionDiff.removed.length > 0 ||
      assertionDiff.changed.length > 0;

    if (!hasChanges) return null;

    return {
      stepNumber: existing.step,
      name: existing.name,
      addedActions: actionDiff.added,
      removedActions: actionDiff.removed,
      changedActions: actionDiff.changed,
      addedAssertions: assertionDiff.added,
      removedAssertions: assertionDiff.removed,
      changedAssertions: assertionDiff.changed,
    };
  }

  private diffActions(generated: TestAction[], existing: TestAction[]) {
    const added: TestAction[] = [];
    const removed: TestAction[] = [];
    const changed: { index: number; before: TestAction; after: TestAction }[] = [];

    const matchedExisting = new Set<number>();

    for (const gen of generated) {
      const matchIdx = existing.findIndex(
        (ex, i) => !matchedExisting.has(i) && this.actionsMatch(gen, ex)
      );

      if (matchIdx === -1) {
        added.push(gen);
      } else {
        matchedExisting.add(matchIdx);
        if (!this.actionsEqual(gen, existing[matchIdx])) {
          changed.push({ index: matchIdx, before: existing[matchIdx], after: gen });
        }
      }
    }

    for (let i = 0; i < existing.length; i++) {
      if (!matchedExisting.has(i)) {
        removed.push(existing[i]);
      }
    }

    return { added, removed, changed };
  }

  private diffAssertions(generated: TestAssertion[], existing: TestAssertion[]) {
    const added: TestAssertion[] = [];
    const removed: TestAssertion[] = [];
    const changed: { index: number; before: TestAssertion; after: TestAssertion }[] = [];

    const matchedExisting = new Set<number>();

    for (const gen of generated) {
      const matchIdx = existing.findIndex(
        (ex, i) => !matchedExisting.has(i) && gen.type === ex.type
      );

      if (matchIdx === -1) {
        added.push(gen);
      } else {
        matchedExisting.add(matchIdx);
        if (JSON.stringify(gen) !== JSON.stringify(existing[matchIdx])) {
          changed.push({ index: matchIdx, before: existing[matchIdx], after: gen });
        }
      }
    }

    for (let i = 0; i < existing.length; i++) {
      if (!matchedExisting.has(i)) {
        removed.push(existing[i]);
      }
    }

    return { added, removed, changed };
  }

  private actionsMatch(a: TestAction, b: TestAction): boolean {
    if (a.type !== b.type) return false;
    if (a.label && b.label) {
      return this.nameSimilarity(a.label, b.label) > 0.5;
    }
    return a.type === b.type;
  }

  private actionsEqual(a: TestAction, b: TestAction): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  private nameSimilarity(a: string, b: string): number {
    const aLower = a.toLowerCase().trim();
    const bLower = b.toLowerCase().trim();

    if (aLower === bLower) return 1;

    const aWords = new Set(aLower.split(/\s+/));
    const bWords = new Set(bLower.split(/\s+/));
    let intersection = 0;
    for (const word of aWords) {
      if (bWords.has(word)) intersection++;
    }
    const union = new Set([...aWords, ...bWords]).size;
    return union > 0 ? intersection / union : 0;
  }

  private findInsertPosition(step: FlowStep, existing: FlowStep[]): number {
    // Try to insert based on phase order or at the end
    if (step.phase) {
      let lastSamePhase = -1;
      for (let i = existing.length - 1; i >= 0; i--) {
        if (existing[i].phase === step.phase) { lastSamePhase = i; break; }
      }
      if (lastSamePhase >= 0) return lastSamePhase + 1;
    }
    return existing.length;
  }
}
