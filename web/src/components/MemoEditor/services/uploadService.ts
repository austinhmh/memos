import { create } from "@bufbuild/protobuf";
import { attachmentServiceClient } from "@/connect";
import type { Attachment } from "@/types/proto/api/v1/attachment_service_pb";
import { AttachmentSchema } from "@/types/proto/api/v1/attachment_service_pb";
import type { LocalFile } from "../types/attachment";

export const uploadService = {
  async uploadFiles(localFiles: LocalFile[]): Promise<Attachment[]> {
    if (localFiles.length === 0) return [];

    const attachments: Attachment[] = [];

    for (const { file } of localFiles) {
      // #region agent log
      fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'uploadService.ts:14',message:'Processing file',data:{fileName:file.name,fileSize:file.size,fileType:file.type},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      
      const buffer = new Uint8Array(await file.arrayBuffer());
      
      // #region agent log
      fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'uploadService.ts:15',message:'Buffer created',data:{bufferLength:buffer.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
      // #endregion
      
      try {
        const attachmentRequest = create(AttachmentSchema, {
          filename: file.name,
          size: BigInt(file.size),
          type: file.type,
          content: buffer,
        });
        
        // #region agent log
        fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'uploadService.ts:16',message:'Calling createAttachment',data:{hasFilename:!!attachmentRequest.filename,hasContent:!!attachmentRequest.content,contentLength:attachmentRequest.content?.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        
        const attachment = await attachmentServiceClient.createAttachment({
          attachment: attachmentRequest,
        });
        
        // #region agent log
        fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'uploadService.ts:23',message:'createAttachment success',data:{attachmentName:attachment.name},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        
        attachments.push(attachment);
      } catch (error) {
        // #region agent log
        fetch('http://localhost:7249/ingest/b652078c-43be-4b87-a877-2bac20439eec',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'uploadService.ts:error',message:'createAttachment failed',data:{error:error instanceof Error?{message:error.message,name:error.name,stack:error.stack,code:(error as any).code,rawMessage:(error as any).rawMessage}:String(error)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        throw error;
      }
    }

    return attachments;
  },
};
