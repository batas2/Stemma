import { describe, it, expect, beforeEach } from 'vitest';
import {
  forgetOnboarding, hasSeenFirstElementExplainer, markFirstElementExplained,
  shouldExplainFirstElement, shouldShowEmptyCanvasGuide,
} from './onboarding';

/**
 * The first ten minutes (F-003). Each of these is a rule about showing someone something *once*,
 * which is the kind of rule that decays silently when it lives inside a render.
 */

beforeEach(() => forgetOnboarding());

describe('the empty-model guide', () => {
  it('appears when a workspace is open and the model has nothing in it', () => {
    // The blank-canvas dead end: right-click, the palette and ⌘K are all invisible until you
    // already know they exist.
    expect(shouldShowEmptyCanvasGuide(true, 0)).toBe(true);
  });

  it('goes away for good once the model has an element', () => {
    expect(shouldShowEmptyCanvasGuide(true, 1)).toBe(false);
    expect(shouldShowEmptyCanvasGuide(true, 42)).toBe(false);
  });

  it('stays away when no workspace is open', () => {
    // That is the start screen's job. Drawing both is how a first run says two things at once.
    expect(shouldShowEmptyCanvasGuide(false, 0)).toBe(false);
  });
});

describe('explaining the first element', () => {
  it('fires for the element that takes the model out of empty', () => {
    expect(shouldExplainFirstElement(false, 0)).toBe(true);
  });

  it('does not fire for the second element, or the twentieth', () => {
    expect(shouldExplainFirstElement(false, 1)).toBe(false);
    expect(shouldExplainFirstElement(false, 20)).toBe(false);
  });

  it('does not fire again for someone who has already been shown it', () => {
    // Its whole job is to teach one thing and then never be seen again — including in the next
    // model this person creates.
    expect(shouldExplainFirstElement(true, 0)).toBe(false);
  });
});

describe('remembering that it was shown', () => {
  it('starts off unseen', () => {
    expect(hasSeenFirstElementExplainer()).toBe(false);
  });

  it('remembers a dismissal', () => {
    markFirstElementExplained();
    expect(hasSeenFirstElementExplainer()).toBe(true);
  });

  it('survives being asked twice', () => {
    markFirstElementExplained();
    markFirstElementExplained();
    expect(hasSeenFirstElementExplainer()).toBe(true);
  });

  it('treats storage it cannot read as "not yet seen" rather than failing', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() { throw new Error('storage disabled'); },
    });
    try {
      // Private browsing. Showing the explainer twice is a far smaller cost than a canvas that
      // will not render.
      expect(() => hasSeenFirstElementExplainer()).not.toThrow();
      expect(hasSeenFirstElementExplainer()).toBe(false);
      expect(() => markFirstElementExplained()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
});
