export interface PromptMessageViewerMessage {
  content: string;
  role: "system" | "user" | (string & {});
}

export interface PromptMessageViewerProps {
  messages: readonly PromptMessageViewerMessage[];
  title?: string;
}

function roleLabel(role: string): string {
  if (role === "system") {
    return "System instructions";
  }

  if (role === "user") {
    return "User request";
  }

  return role.charAt(0).toUpperCase() + role.slice(1);
}

export function PromptMessageViewer({
  messages,
  title = "Prompt messages",
}: PromptMessageViewerProps) {
  return (
    <section className="sketchi-prompt-message-viewer">
      <h2>{title}</h2>
      <div className="sketchi-prompt-message-viewer__messages">
        {messages.map((message) => {
          const label = roleLabel(message.role);

          return (
            <article
              className="sketchi-prompt-message-viewer__message"
              key={`${message.role}:${message.content}`}
            >
              <h3>{label}</h3>
              <pre aria-label={`${label} prompt`}>{message.content}</pre>
            </article>
          );
        })}
      </div>
    </section>
  );
}
