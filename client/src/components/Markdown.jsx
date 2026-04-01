// client/src/components/Markdown.jsx
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

export default function Markdown({ text }) {
  if (!text) return null;

  try {
    return (
      <div className="prose prose-sm prose-slate max-w-none prose-p:my-1.5 prose-li:ml-4 prose-code:rounded prose-code:bg-slate-100 prose-code:px-1 prose-code:py-0.5 prose-code:border prose-code:border-slate-200 prose-code:text-sm prose-code:before:content-none prose-code:after:content-none prose-pre:bg-slate-50 prose-pre:border prose-pre:border-slate-200 prose-pre:rounded-lg">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeRaw, rehypeSanitize]}
        >
          {text}
        </ReactMarkdown>
      </div>
    );
  } catch {
    return <span className="whitespace-pre-wrap">{text}</span>;
  }
}
