import type { GitInfo } from '../types';

/**
 * Git panel (DESIGN §5.2): branch pill, ahead/behind, last commit + relative
 * time. Degrades to friendly copy when not a repo or git is unavailable.
 */
export function GitPanel({ git, error }: { git: GitInfo | null; error: string | null }) {
  return (
    <section className="panel">
      <div className="panel-head">Git</div>
      <div className="panel-body">
        {error ? (
          <span className="panel-empty">{error}</span>
        ) : !git ? (
          <span className="panel-empty">Reading repository…</span>
        ) : !git.isRepo ? (
          <span className="panel-empty">Not a git repository.</span>
        ) : (
          <div className="git">
            <div className="git-row">
              <span className="branch-pill">⎇ {git.branch}</span>
              <span className="ahead-behind">
                ↑{git.ahead ?? 0} ↓{git.behind ?? 0}
              </span>
              {git.dirty && <span className="dirty-tag">dirty</span>}
            </div>
            {git.lastCommit && (
              <div className="commit">
                <span className="commit-hash">{git.lastCommit.hash}</span>
                <span className="commit-subject" title={git.lastCommit.subject}>
                  {git.lastCommit.subject}
                </span>
                <span className="commit-when">{git.lastCommit.relative}</span>
              </div>
            )}
            {git.remoteUrl && (
              <a className="git-remote" href={git.remoteUrl} target="_blank" rel="noreferrer">
                {git.remoteUrl.replace(/^https?:\/\//, '')}
              </a>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
