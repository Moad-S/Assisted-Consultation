// client/src/components/Markdown.jsx
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

/**
 * Safe, styled Markdown renderer.
 * Falls back to plain text if anything goes wrong.
 */
export default function Markdown({ text }) {
  if (!text) return null;

  try {
    return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, rehypeSanitize]}
        // light opinionated defaults so **bold**, lists, etc look good
        components={{
          p: ({ node, ...props }) => (
            <p style={{ margin: "6px 0" }} {...props} />
          ),
          li: ({ node, ...props }) => (
            <li style={{ marginLeft: 16 }} {...props} />
          ),
          strong: ({ node, ...props }) => (
            <strong style={{ fontWeight: 700 }} {...props} />
          ),
          em: ({ node, ...props }) => (
            <em style={{ opacity: 0.95 }} {...props} />
          ),
          code: ({ node, inline, ...props }) =>
            inline ? (
              <code
                style={{
                  padding: "0 4px",
                  borderRadius: 4,
                  background: "#151515",
                  border: "1px solid #2a2a2a",
                }}
                {...props}
              />
            ) : (
              <pre
                style={{
                  padding: 10,
                  borderRadius: 8,
                  background: "#0f0f0f",
                  border: "1px solid #2a2a2a",
                  overflowX: "auto",
                }}
              >
                <code {...props} />
              </pre>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    );
  } catch {
    // absolutely-safe fallback so the UI never blanks
    return <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>;
  }
}
