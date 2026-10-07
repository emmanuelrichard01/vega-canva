import React, { useSyncExternalStore } from 'react';
import { Check } from 'lucide-react';
import { keyFor, type Lesson } from '../../engine/learn/lessons';
import { isWalkable } from '../../engine/learn/walkthrough';
import { walkthroughState } from '../../engine/learn/walkthroughState';
import { LessonDemo } from '../learn/LessonDemo';
import { capsFor } from '../menu/shortcuts';

/**
 * One lesson in full: its demo, its steps, and the offer to do it on the board.
 *
 * The coach mark on the canvas shows two steps because it sits over work in
 * progress; here nothing competes, so every step is shown. The demo is the
 * LESSONS builder's `LessonDemo`, so the drawing here and on the coach mark is
 * one drawing.
 *
 * "Done" means the walkthrough was performed, every step observed in order. It
 * never hides anything: a reference that withheld what you know would be a
 * reference you could not check.
 */
export const HelpLesson: React.FC<{ lesson: Lesson; onWalk: (id: string) => void }> = ({ lesson, onWalk }) => {
  const { done } = useSyncExternalStore(walkthroughState.subscribe, walkthroughState.getSnapshot, walkthroughState.getSnapshot);
  const key = keyFor(lesson);
  const walkable = isWalkable(lesson.id);
  const performed = walkable && done.includes(lesson.id);

  return (
    <article className="hc-lesson">
      {lesson.demo && <LessonDemo demo={lesson.demo} />}
      <div className="hc-lesson__body">
        <h4 className="hc-lesson__title">
          <span>{lesson.title}</span>
          {key && <kbd>{capsFor(key)[0]}</kbd>}
          {performed && (
            <span className="hc-lesson__done">
              <Check size={11} aria-hidden="true" /> Done
            </span>
          )}
        </h4>
        <p className="hc-lesson__gist">{lesson.gist}</p>
        <ol className="hc-lesson__steps">
          {lesson.steps.map((step) => (
            <li key={step.act}>
              <span className="hc-lesson__act">{step.act}</span>
              <span className="hc-lesson__gives">{step.gives}</span>
            </li>
          ))}
        </ol>
        {walkable && (
          <button type="button" className="dlg-btn dlg-btn--outline hc-lesson__walk" onClick={() => onWalk(lesson.id)}>
            {performed ? 'Do it again' : 'Walk me through it'}
          </button>
        )}
      </div>
    </article>
  );
};
