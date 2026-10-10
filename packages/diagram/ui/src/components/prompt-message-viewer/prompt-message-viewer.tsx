export interface PromptMessageViewerProps {
  system: string;
  title?: string;
  user: string;
}

export function PromptMessageViewer({
  system,
  title = "Prompt messages",
  user,
}: PromptMessageViewerProps) {
  const messages = [
    { content: system, label: "System instructions" },
    { content: user, label: "User request" },
  ];

  return (
    <section className="sketchi-prompt-message-viewer">
      <h2>{title}</h2>
      <div className="sketchi-prompt-message-viewer__messages">
        {messages.map(({ content, label }) => (
          <article
            className="sketchi-prompt-message-viewer__message"
            key={label}
          >
            <h3>{label}</h3>
            <pre aria-label={`${label} prompt`}>{content}</pre>
          </article>
        ))}
      </div>
    </section>
  );
}
