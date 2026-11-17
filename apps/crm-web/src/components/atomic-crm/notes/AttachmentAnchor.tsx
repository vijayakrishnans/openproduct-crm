import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { useNotify } from "ra-core";

import { fetchAttachment, isStoredAttachment } from "../providers/lumen/attachments";

/** A URL the browser can show for an attachment: its own `src` when that is a
 *  real URL (the demo, a file just picked), or an in-memory copy fetched with
 *  the session when the file is stored by the API. */
const useAttachmentUrl = (src: string | undefined, enabled: boolean): string | undefined => {
  const stored = isStoredAttachment(src);
  const [objectUrl, setObjectUrl] = useState<string>();

  useEffect(() => {
    if (!stored || !enabled || !src) return;
    let url: string | undefined;
    let cancelled = false;
    fetchAttachment(src)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setObjectUrl(url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [src, stored, enabled]);

  return stored ? objectUrl : src;
};

/**
 * Link to an attachment, with a thumbnail when it is an image. Stored files
 * are loaded with the session: images at once (for the thumbnail), other files
 * only when clicked.
 */
export const AttachmentAnchor = ({
  src,
  title,
  image,
  target = "_blank",
  download,
  className,
  children,
}: {
  src: string | undefined;
  title?: string;
  image: boolean;
  target?: string;
  download?: boolean | string;
  className?: string;
  children?: ReactNode;
}) => {
  const notify = useNotify();
  const stored = isStoredAttachment(src);
  const url = useAttachmentUrl(src, image);

  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    // useful to prevent click bubbling in a DataTable with rowClick
    event.stopPropagation();
    if (!stored || !src) return;
    event.preventDefault();
    fetchAttachment(src)
      .then((blob) => {
        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = title ?? "attachment";
        link.click();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      })
      .catch(() => notify("Failed to load attachment", { type: "error" }));
  };

  return (
    <a
      href={stored ? "#" : src}
      title={title}
      target={stored ? undefined : target}
      rel="noopener noreferrer"
      download={download}
      className={className}
      onClick={open}
    >
      {image ? (
        <img
          src={url}
          alt={title}
          title={title}
          className="w-[200px] h-[100px] object-cover cursor-pointer object-left border border-border"
        />
      ) : (
        (children ?? title)
      )}
    </a>
  );
};
