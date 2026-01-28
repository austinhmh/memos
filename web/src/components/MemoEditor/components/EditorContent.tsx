import { forwardRef } from "react";
import Editor, { type EditorRefActions } from "../Editor";
import { useBlobUrls, useDragAndDrop } from "../hooks";
import { useEditorContext } from "../state";
import { uploadService } from "../services/uploadService";
import type { EditorContentProps } from "../types";
import type { LocalFile } from "../types/attachment";

export const EditorContent = forwardRef<EditorRefActions, EditorContentProps>(({ placeholder, textAreaRef }, ref) => {
  const { state, actions, dispatch } = useEditorContext();
  const { createBlobUrl } = useBlobUrls();

  const { dragHandlers } = useDragAndDrop((files: FileList) => {
    const localFiles: LocalFile[] = Array.from(files).map((file) => ({
      file,
      previewUrl: createBlobUrl(file),
    }));
    localFiles.forEach((localFile) => dispatch(actions.addLocalFile(localFile)));
  });

  const handleCompositionStart = () => {
    dispatch(actions.setComposing(true));
  };

  const handleCompositionEnd = () => {
    dispatch(actions.setComposing(false));
  };

  const handleContentChange = (content: string) => {
    dispatch(actions.updateContent(content));
  };

  const handlePaste = async (event: React.ClipboardEvent) => {
    // #region agent log
    fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EditorContent.tsx:33',message:'handlePaste called',data:{hasClipboardData:!!event.clipboardData},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
    // #endregion
    
    const items = event.clipboardData?.items;
    if (!items) {
      // #region agent log
      fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EditorContent.tsx:35',message:'No clipboard items',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      console.log('[EditorContent] Paste event detected, but no clipboard items');
      return;
    }

    // #region agent log
    fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EditorContent.tsx:40',message:'Clipboard items found',data:{itemsLength:items.length,itemsDetails:Array.from(items).map((it,idx)=>({idx,kind:it.kind,type:it.type}))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
    // #endregion
    console.log('[EditorContent] Paste event detected, items count:', items.length);

    // Extract image files from clipboard
    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file" && item.type.indexOf('image') !== -1) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
          // #region agent log
          fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EditorContent.tsx:49',message:'Image file extracted',data:{fileName:file.name,fileSize:file.size,fileType:file.type},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
          // #endregion
        }
      }
    }

    if (imageFiles.length === 0) {
      // #region agent log
      fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EditorContent.tsx:54',message:'No image files found',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'B'})}).catch(()=>{});
      // #endregion
      console.log('[EditorContent] No image files found in clipboard');
      return;
    }

    console.log('[EditorContent] Found image files:', imageFiles.length);
    event.preventDefault();

    try {
      // Set uploading state
      dispatch(actions.setLoading('uploading', true));
      console.log('[EditorContent] Uploading files...');

      // Convert to LocalFile format and upload
      const localFiles: LocalFile[] = imageFiles.map((file) => ({
        file,
        previewUrl: createBlobUrl(file),
      }));

      // #region agent log
      fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EditorContent.tsx:73',message:'Before upload',data:{localFilesCount:localFiles.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion

      const attachments = await uploadService.uploadFiles(localFiles);
      
      // #region agent log
      fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EditorContent.tsx:74',message:'Upload success',data:{attachmentsCount:attachments.length,attachments:attachments.map(a=>({name:a.name,filename:a.filename}))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      console.log('[EditorContent] Upload success, attachments:', attachments);

      // Insert Markdown syntax at cursor position
      // #region agent log
      fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EditorContent.tsx:77',message:'Check editor ref',data:{hasRef:!!ref,isFunction:typeof ref==='function',hasCurrent:ref&&typeof ref!=='function'?!!ref.current:false},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
      // #endregion
      
      if (ref && typeof ref !== 'function' && ref.current) {
        const editorRef = ref.current;
        for (const attachment of attachments) {
          // Extract UID from attachment.name (format: "attachments/{uid}")
          const uid = attachment.name.replace('attachments/', '');
          const imageUrl = `/file/attachments/${uid}/${attachment.filename}`;
          const markdown = `![${attachment.filename}](${imageUrl})`;
          
          // #region agent log
          fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EditorContent.tsx:85',message:'Before insertText',data:{attachmentName:attachment.name,uid,imageUrl,markdown,hasInsertText:typeof editorRef.insertText==='function'},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'E'})}).catch(()=>{});
          // #endregion
          
          editorRef.insertText(markdown);
          console.log('[EditorContent] Inserted markdown at cursor position:', markdown);
        }
      } else {
        // #region agent log
        fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EditorContent.tsx:89',message:'Editor ref not available',data:{},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'D'})}).catch(()=>{});
        // #endregion
        console.warn('[EditorContent] Editor ref not available, cannot insert markdown');
      }
    } catch (error) {
      // #region agent log
      fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'EditorContent.tsx:92',message:'Upload failed with error',data:{error:error instanceof Error?{message:error.message,stack:error.stack}:String(error)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'C'})}).catch(()=>{});
      // #endregion
      console.error('[EditorContent] Upload failed:', error);
      // Error handling - user can retry by pasting again
    } finally {
      dispatch(actions.setLoading('uploading', false));
    }
  };

  return (
    <div className="w-full flex flex-col flex-1" {...dragHandlers}>
      <Editor
        ref={ref}
        textAreaRef={textAreaRef}
        className="memo-editor-content"
        initialContent={state.content}
        placeholder={placeholder || ""}
        isFocusMode={state.ui.isFocusMode}
        isInIME={state.ui.isComposing}
        onContentChange={handleContentChange}
        onPaste={handlePaste}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
      />
    </div>
  );
});

EditorContent.displayName = "EditorContent";
