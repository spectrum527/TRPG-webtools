import { PenLine, Sparkles } from 'lucide-react';
import { Modal } from './ui';

export function Acknowledgements({ onClose }: { onClose: () => void }) {
  return (
    <Modal
      title="鸣谢"
      subtitle="幕间 Interlude"
      className="acknowledgements-modal"
      onClose={onClose}
    >
      <div className="credits-list">
        <section className="credits-card">
          <span className="credits-icon" aria-hidden="true">
            <PenLine size={21} strokeWidth={1.6} />
          </span>
          <div>
            <span className="mini-label">作者</span>
            <h3>Liino/Alex9125</h3>
            <p>负责整个项目的设计与开发，并持续维护。</p>
          </div>
        </section>
        <section className="credits-card">
          <span className="credits-icon" aria-hidden="true">
            <Sparkles size={21} strokeWidth={1.6} />
          </span>
          <div>
            <span className="mini-label">AI 协作</span>
            <h3>OpenAI · ChatGPT / Codex</h3>
            <p>开发过程中借助 ChatGPT 与 Codex 梳理功能、编写和测试代码，并持续调整界面。</p>
          </div>
        </section>
      </div>
    </Modal>
  );
}
