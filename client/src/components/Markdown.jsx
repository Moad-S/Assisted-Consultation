import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize from "rehype-sanitize";

export default function Markdown({ text }) {
  if (!text) return null;

  try {
    return (
      <div className="prose prose-sm prose-stone max-w-none prose-p:my-1.5 prose-p:leading-relaxed prose-li:ml-4 prose-code:rounded-lg prose-code:bg-canvas prose-code:px-1.5 prose-code:py-0.5 prose-code:border prose-code:border-border prose-code:text-sm prose-code:font-normal prose-code:before:content-none prose-code:after:content-none prose-pre:bg-canvas prose-pre:border prose-pre:border-border prose-pre:rounded-xl prose-headings:font-display prose-headings:tracking-tight prose-a:text-primary-600 prose-a:no-underline hover:prose-a:underline prose-strong:font-semibold">
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
