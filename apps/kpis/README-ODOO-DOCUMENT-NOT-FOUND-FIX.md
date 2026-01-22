# Odoo "Document Not Found" Issue - Fix Documentation

## Problem Description

When invoices are added to Odoo via the API with attachments, they often display a "The document could not be found -> Retry" message in the Odoo dashboard. Clicking the "Retry" link successfully loads the document and triggers the OCR service. However, without manually clicking this link:

- The OCR service is never automatically triggered
- Invoice details (price, date, supplier) remain empty
- Approvals cannot proceed

## Root Cause

The issue occurs because when attachments are uploaded via API, Odoo doesn't immediately populate the `message_main_attachment_id` field on the `account.move` (invoice) record. This field is what the OCR service (`action_reload_ai_data`) uses to locate and process the invoice document.

**The "Retry" button** in Odoo essentially re-associates the attachment with the invoice by setting this field, which then allows the OCR to find and process the document.

## Solution Implemented

The fix involves **programmatically linking attachments to invoices** before triggering OCR processing, mimicking what the "Retry" button does manually.

### Key Components

#### 1. Attachment Linkage Function (`ensureInvoiceAttachmentLinkage`)

This function:
1. Checks if `message_main_attachment_id` is already set on the invoice
2. If not, searches for attachments linked to the invoice via `ir.attachment`
3. Sets the first available attachment as the `message_main_attachment_id`
4. Returns whether the operation was successful

**Location:** 
- `apps/kpis/src/lib/odoo/services.ts` (for batch operations)
- `apps/kpis/src/app/api/invoices/[id]/refresh-ocr/route.ts` (for single invoice)
- `apps/kpis/src/app/api/invoices/fix-attachments/route.ts` (for manual fixes)

#### 2. Modified OCR Refresh Flow

The OCR refresh process now follows these steps:

```
1. Identify zero-value invoices (indicating missing OCR data)
2. For each invoice:
   a. Check if message_main_attachment_id is set
   b. If not, search for attachments and link the first one
   c. Only proceed with OCR if an attachment was successfully linked
   d. Call action_reload_ai_data to trigger OCR processing
3. Track and report results
```

**Modified files:**
- `apps/kpis/src/lib/odoo/services.ts` - Background OCR refresh for multiple invoices
- `apps/kpis/src/app/api/invoices/[id]/refresh-ocr/route.ts` - Single invoice OCR refresh

#### 3. Manual Fix Endpoint

A new API endpoint allows for retroactive fixing of existing invoices:

**Endpoint:** `/api/invoices/fix-attachments`

**Methods:**

- **POST** - Fix specific invoices
  ```bash
  curl -X POST /api/invoices/fix-attachments \
    -H "Content-Type: application/json" \
    -d '{"invoiceIds": [123, 456, 789]}'
  ```

- **GET** - Automatically find and fix all zero-value invoices (max 100 at a time)
  ```bash
  curl -X GET /api/invoices/fix-attachments
  ```

**Response Format:**
```json
{
  "success": true,
  "summary": {
    "total": 50,
    "successful": 45,
    "failed": 5,
    "linked": 30,
    "alreadyLinked": 15,
    "noAttachment": 5
  },
  "results": [
    {
      "invoiceId": 123,
      "success": true,
      "action": "linked",
      "message": "Successfully linked attachment 456",
      "attachmentId": 456
    }
    // ... more results
  ]
}
```

## Odoo Fields Reference

### account.move (Invoice)
- `message_main_attachment_id` - Reference to the primary attachment used for OCR processing
  - Type: `many2one` to `ir.attachment`
  - When this is `False`, Odoo shows "document not found"

### ir.attachment (Attachment)
- `res_model` - Model the attachment is linked to (e.g., "account.move")
- `res_id` - ID of the record the attachment is linked to
- `id` - Attachment ID used to populate `message_main_attachment_id`

## Usage Examples

### Automatic Fix (Existing Behavior)

The fix is automatically applied in multiple scenarios:

#### 1. Single Invoice Detail View (`getInvoice()`)
When you open any invoice detail page:
- System checks if invoice has zero value + attachments
- If attachment exists but not linked → links it automatically
- Triggers OCR processing immediately
- **Note:** OCR processing takes 5-30 seconds, you may need to refresh the page to see updated values

#### 2. Invoice List Views (`getAllInvoices()`)
When invoice lists are loaded:
- System detects zero-value invoices during normal fetching
- Filters to only those with attachments
- Background OCR refresh is triggered for batch processing
- Progress is tracked and reported

#### 3. Manual Trigger
- User can explicitly call the refresh-ocr endpoint
- Useful for retry or force-refresh scenarios

No code changes needed for automatic fixes - they happen transparently!

### Manual Fix for Existing Invoices

If you have existing invoices with the "document not found" issue:

**Option 1: Fix All Zero-Value Invoices**
```bash
# Simply make a GET request to the fix endpoint
curl -X GET https://your-domain.com/api/invoices/fix-attachments
```

**Option 2: Fix Specific Invoices**
```typescript
const invoiceIds = [123, 456, 789];
const response = await fetch('/api/invoices/fix-attachments', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ invoiceIds })
});
const result = await response.json();
console.log(`Fixed ${result.summary.linked} invoices`);
```

### Single Invoice Refresh

The single invoice refresh endpoint now automatically fixes attachment linkage:

```typescript
const response = await fetch(`/api/invoices/${invoiceId}/refresh-ocr`, {
  method: 'POST'
});
const result = await response.json();
// result.attachmentLinkage will indicate if an attachment was linked
```

## Implementation Details

### Why This Works

Odoo's OCR service (`action_reload_ai_data` method) relies on `message_main_attachment_id` to locate the document to process. When this field is empty:
- Odoo cannot find the document → "Document not found" error
- OCR is not triggered
- Invoice details remain empty

By programmatically setting `message_main_attachment_id` to point to an existing attachment, we:
- Make the document "findable" by Odoo
- Enable OCR processing to proceed
- Eliminate the need for manual "Retry" clicks

### Error Handling

The implementation handles various scenarios:

1. **No attachment exists** - **Pre-filtered before OCR processing** to prevent repeated API calls for invoices legitimately without attachments
2. **Attachment already linked** - Skips linkage, proceeds to OCR
3. **Multiple attachments** - Links the first one (you can modify to select specific types)
4. **Linkage fails** - Logs error, skips OCR for that invoice

### Handling Invoices Without Attachments

The system intelligently handles invoices that legitimately have no attachments:

1. **Pre-filtering**: Before triggering OCR refresh, the system checks which zero-value invoices actually have attachments
2. **Only invoices with attachments are processed** for OCR, preventing unnecessary API calls
3. **Invoices without attachments are ignored** - they won't repeatedly trigger OCR attempts
4. **Logging shows the distinction**: 
   ```
   Found 10 zero-value invoices, 6 have attachments to process
   ```

This prevents the system from endlessly checking invoices that were intentionally created without attachments.

### Logging

Detailed logging is provided at each step:
```
Starting background OCR refresh for 10 invoices...
Linking attachment 12345 to invoice 6789 as message_main_attachment_id
Successfully linked attachment 12345 to invoice 6789
Successfully refreshed OCR data for invoice 6789
Background OCR refresh completed in 15432ms: 8/10 successful, 2 failed, 0 without attachments
```

## Testing the Fix

### 1. Test with New Invoices

1. Create an invoice via API with an attachment (current workflow)
2. Check that the invoice appears with zero values initially
3. Wait for automatic OCR refresh (or trigger manually)
4. Verify that attachment is linked and OCR processes successfully
5. Confirm invoice details are populated

### 2. Test with Existing Invoices

1. Identify invoices with "document not found" issue (zero values + attachments exist)
2. Call the fix endpoint: `GET /api/invoices/fix-attachments`
3. Review the response to see which invoices were fixed
4. Check Odoo to confirm documents are now accessible
5. Trigger OCR refresh if needed

### 3. Monitor Logs

Check server logs for:
- Successful attachment linkage messages
- OCR processing success/failure
- Any error patterns

## Future Enhancements

Potential improvements to consider:

1. **Attachment Selection Logic** - If multiple attachments exist, implement logic to select the most appropriate one (e.g., PDF over images, largest file, most recent)

2. **Retry Logic** - Add automatic retry with exponential backoff if attachment linkage or OCR fails

3. **Webhook Integration** - Use Odoo webhooks to detect when attachments are added and immediately link them

4. **Extract API** - Consider using Odoo's Extract API for more robust OCR processing (though this may require additional configuration)

5. **Monitoring Dashboard** - Create a UI to monitor OCR processing status and manually trigger fixes

## Troubleshooting

### Issue: Attachment linking succeeds but OCR still fails

**Possible causes:**
- OCR service in Odoo may be disabled or misconfigured
- Document format not supported by OCR
- IAP credits exhausted (if using Odoo's cloud OCR)

**Solution:** Check Odoo logs and IAP account settings

### Issue: No attachments found for invoice

**Possible causes:**
- Attachments were never uploaded
- Attachments are linked to wrong model/record
- Attachments were deleted

**Solution:** Verify attachment upload process and check `ir.attachment` records

### Issue: message_main_attachment_id gets set but resets to False

**Possible causes:**
- Odoo workflow may be resetting the field
- Custom Odoo modules may be interfering

**Solution:** Check Odoo customizations and workflow configurations

## Related Odoo Documentation

- [Odoo 18 Extract API Documentation](https://www.odoo.com/documentation/18.0/developer/reference/extract_api.html)
- [Odoo JSON-RPC API](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html)
- [Account Move Model](https://www.odoo.com/documentation/18.0/developer/reference/backend/orm.html)

## Summary

This fix addresses the "document not found" issue by:
1. **Detecting** when `message_main_attachment_id` is missing
2. **Linking** available attachments to the invoice
3. **Triggering** OCR processing automatically
4. **Providing** tools for retroactive fixes

The solution is implemented transparently in the existing OCR refresh flow and includes a manual fix endpoint for existing problematic invoices.

