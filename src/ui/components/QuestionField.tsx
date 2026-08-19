import { useId } from 'react';
import type { Answers, FactKey } from '@/domain/facts';
import type { Question } from '@/interview/screens';
import { checkedFlags, isFlagsAnswered, selectedChoice } from '@/interview/answers';

/**
 * Renders one question. Every control reads its state back out of `answers`
 * rather than holding its own copy, so navigating back and changing an answer
 * cannot leave the display and the facts disagreeing.
 */

interface Props {
  readonly question: Question;
  readonly answers: Answers;
  readonly onChoice: (question: Question, value: string) => void;
  readonly onFlags: (question: Question, checked: readonly FactKey[]) => void;
  readonly onNumber: (fact: FactKey, value: number) => void;
  readonly onMulti: (fact: FactKey, values: readonly string[]) => void;
}

export function QuestionField({
  question,
  answers,
  onChoice,
  onFlags,
  onNumber,
  onMulti,
}: Props) {
  const groupId = useId();
  const { input } = question;

  return (
    <fieldset className="question">
      <legend className="question__prompt">{question.prompt}</legend>
      {question.help && <p className="question__help">{question.help}</p>}

      {input.type === 'choice' && (
        <div className="choices" role="radiogroup" aria-label={question.prompt}>
          {input.choices.map((choice) => {
            const id = `${groupId}-${choice.value}`;
            return (
              <label key={choice.value} className="choice" htmlFor={id}>
                <input
                  id={id}
                  type="radio"
                  name={groupId}
                  checked={selectedChoice(question, answers) === choice.value}
                  onChange={() => onChoice(question, choice.value)}
                />
                <span>
                  <span className="choice__label">{choice.label}</span>
                  {choice.hint && <span className="choice__hint">{choice.hint}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {input.type === 'flags' && (
        <div className="choices">
          {input.flags.map((flag) => {
            const id = `${groupId}-${flag.fact}`;
            const checked = answers[flag.fact] === true;
            return (
              <label key={flag.fact} className="choice" htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  checked={checked}
                  onChange={(e) => {
                    const current = new Set(checkedFlags(question, answers));
                    if (e.target.checked) current.add(flag.fact);
                    else current.delete(flag.fact);
                    onFlags(question, [...current]);
                  }}
                />
                <span>
                  <span className="choice__label">{flag.label}</span>
                  {flag.hint && <span className="choice__hint">{flag.hint}</span>}
                </span>
              </label>
            );
          })}
          {/*
            "None of these" has to be an explicit action. An untouched checklist
            and a deliberate "none" look identical in the DOM, but they mean
            very different things to the engine -- unknown versus all-false --
            so the user has to be able to say which one they mean.
          */}
          <button
            type="button"
            className={`choice choice--none ${isFlagsAnswered(question, answers) && checkedFlags(question, answers).length === 0 ? 'is-selected' : ''}`}
            onClick={() => onFlags(question, [])}
          >
            {input.noneLabel}
          </button>
        </div>
      )}

      {input.type === 'multi' && (
        <div className="choices">
          {input.choices.map((choice) => {
            const id = `${groupId}-${choice.value}`;
            const current = (answers[input.fact] as readonly string[] | undefined) ?? [];
            return (
              <label key={choice.value} className="choice" htmlFor={id}>
                <input
                  id={id}
                  type="checkbox"
                  checked={current.includes(choice.value)}
                  onChange={(e) => {
                    const next = new Set(current);
                    if (e.target.checked) next.add(choice.value);
                    else next.delete(choice.value);
                    onMulti(input.fact, [...next]);
                  }}
                />
                <span className="choice__label">{choice.label}</span>
              </label>
            );
          })}
          <button
            type="button"
            className={`choice choice--none ${Array.isArray(answers[input.fact]) && (answers[input.fact] as string[]).length === 0 ? 'is-selected' : ''}`}
            onClick={() => onMulti(input.fact, [])}
          >
            {input.noneLabel}
          </button>
        </div>
      )}

      {input.type === 'number' && (
        <div className="number">
          {input.prefix && <span className="number__affix">{input.prefix}</span>}
          <input
            type="number"
            inputMode="numeric"
            min={input.min}
            max={input.max}
            step={input.step}
            placeholder={input.placeholder}
            value={
              typeof answers[input.fact] === 'number' ? String(answers[input.fact]) : ''
            }
            onChange={(e) => {
              const value = Number(e.target.value);
              if (e.target.value !== '' && Number.isFinite(value)) {
                onNumber(input.fact, value);
              }
            }}
            aria-label={question.prompt}
          />
          {input.suffix && <span className="number__affix">{input.suffix}</span>}
        </div>
      )}
    </fieldset>
  );
}
