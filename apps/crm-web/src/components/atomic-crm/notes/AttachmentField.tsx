import { useFieldValue, useRecordContext, useTranslate } from "ra-core";
import type { FileFieldProps } from "@/components/admin";
import { cn } from "@/lib/utils";
import { AttachmentAnchor } from "./AttachmentAnchor";

/**
 * Displays a preview for a single attachment record.
 *
 * This component is inspired by react-admin's `ImageField` and is intended for
 * usage inside a `<FileInput>`, where the current attachment is provided through
 * the record context.
 *
 * @param props - FileFieldProps provided by react-admin file inputs.
 * @returns An image preview for image attachments, or a regular link for other files.
 */
export const AttachmentField = (props: FileFieldProps) => {
  const {
    className,
    empty,
    title,
    target,
    download,
    defaultValue,
    source,
    record: _recordProp,
    ...rest
  } = props;
  const record = useRecordContext();
  const sourceValue = useFieldValue({ defaultValue, source, record });
  const titleValue =
    useFieldValue({
      ...props,
      // @ts-expect-error We ignore here because title might be a custom label or undefined instead of a field name
      source: title,
    })?.toString() ?? title;
  const translate = useTranslate();

  if (sourceValue == null) {
    if (!empty) {
      return null;
    }

    return (
      <div className={cn("inline-block", className)} {...rest}>
        {typeof empty === "string" ? translate(empty, { _: empty }) : empty}
      </div>
    );
  }

  const type = record?.type ?? record?.rawFile?.type;
  const srcValue = sourceValue.toString();

  return (
    <div className={cn("inline-block", className)} {...rest}>
      <AttachmentAnchor
        src={srcValue}
        title={titleValue}
        image={isImageMimeType(type)}
        target={target}
        download={download}
      />
    </div>
  );
};

/**
 * Checks whether a mime type corresponds to an image.
 *
 * @param mimeType - The attachment mime type.
 * @returns `true` when the mime type starts with `image/`.
 */
const isImageMimeType = (mimeType?: string): boolean => {
  if (!mimeType) {
    return false;
  }
  return mimeType.startsWith("image/");
};
