import { NextRequest, NextResponse } from "next/server";
import { odooApi } from "@/lib/odoo/api";

const INVOICE_MODEL = 'account.move';
const ATTACHMENT_MODEL = 'ir.attachment';

/**
 * Regenerate attachment access token - likely what the "Retry" button does
 * This creates a new secure access token for the attachment
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const invoiceId = parseInt(id, 10);
    
    if (isNaN(invoiceId)) {
      return NextResponse.json(
        { error: 'Invalid invoice ID' },
        { status: 400 }
      );
    }

    // Get the invoice's main attachment
    const invoiceData = await odooApi.searchRead(INVOICE_MODEL, [
      ["id", "=", invoiceId]
    ], {
      fields: ["id", "message_main_attachment_id"]
    });

    if (!invoiceData || invoiceData.length === 0) {
      return NextResponse.json(
        { error: 'Invoice not found' },
        { status: 404 }
      );
    }

    const invoice = invoiceData[0];
    const attachmentId = Array.isArray(invoice.message_main_attachment_id)
      ? invoice.message_main_attachment_id[0]
      : invoice.message_main_attachment_id;

    if (!attachmentId) {
      // If no main attachment, find the first attachment
      const attachments = await odooApi.searchRead(ATTACHMENT_MODEL, [
        ["res_model", "=", INVOICE_MODEL],
        ["res_id", "=", invoiceId]
      ], {
        fields: ["id"],
        limit: 1
      });

      if (attachments.length === 0) {
        return NextResponse.json(
          { error: 'No attachments found for this invoice' },
          { status: 404 }
        );
      }

      // Link this attachment as the main one
      const newAttachmentId = attachments[0].id;
      await odooApi.write(INVOICE_MODEL, [invoiceId], {
        message_main_attachment_id: newAttachmentId
      });

      console.log(`Linked attachment ${newAttachmentId} to invoice ${invoiceId}`);
    }

    const finalAttachmentId = attachmentId || (await odooApi.searchRead(ATTACHMENT_MODEL, [
      ["res_model", "=", INVOICE_MODEL],
      ["res_id", "=", invoiceId]
    ], { fields: ["id"], limit: 1 }))[0].id;

    // Try to generate/regenerate the access token
    try {
      console.log(`Generating access token for attachment ${finalAttachmentId}...`);
      
      const result = await odooApi.executeKw(
        ATTACHMENT_MODEL,
        'generate_access_token',
        [[finalAttachmentId]]
      );

      console.log(`Access token generated successfully:`, result);

      return NextResponse.json({
        success: true,
        message: 'Access token regenerated successfully',
        attachmentId: finalAttachmentId,
        token: result
      });
    } catch (tokenError: any) {
      // If generate_access_token doesn't exist, try writing the access_token field directly
      console.log(`generate_access_token failed, trying direct write...`, tokenError.message);
      
      // Generate a random token
      const newToken = `${Date.now()}_${Math.random().toString(36).substring(7)}`;
      
      await odooApi.write(ATTACHMENT_MODEL, [finalAttachmentId], {
        access_token: newToken
      });

      return NextResponse.json({
        success: true,
        message: 'Access token set successfully (via write)',
        attachmentId: finalAttachmentId,
        method: 'write'
      });
    }
  } catch (error: any) {
    console.error('Failed to regenerate attachment token:', error);
    return NextResponse.json(
      { 
        error: 'Failed to regenerate attachment token',
        details: error.message 
      },
      { status: 500 }
    );
  }
}




