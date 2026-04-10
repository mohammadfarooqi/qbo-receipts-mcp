import { z } from "zod";

export const FaultSchema = z.object({
    Fault: z.object({
        Error: z.array(z.object({
            Message: z.string(),
            Detail: z.string().optional(),
            code: z.string(),
            element: z.string().optional()
        })),
        type: z.string()
    }),
    time: z.string().optional()
});
export type Fault = z.infer<typeof FaultSchema>;

export const TokenRefreshResponseSchema = z.object({
    access_token: z.string(),
    refresh_token: z.string(),
    expires_in: z.number(),
    x_refresh_token_expires_in: z.number(),
    token_type: z.string()
});
export type TokenRefreshResponse = z.infer<typeof TokenRefreshResponseSchema>;

const RefSchema = z.object({
    value: z.string(),
    name: z.string().optional()
});

const MetaDataSchema = z.object({
    CreateTime: z.string().optional(),
    LastUpdatedTime: z.string().optional()
}).optional();

export const CompanyInfoSchema = z.object({
    CompanyInfo: z.object({
        Id: z.string(),
        SyncToken: z.string(),
        CompanyName: z.string(),
        Country: z.string().optional(),
        SupportedLanguages: z.string().optional(),
        MetaData: MetaDataSchema
    }),
    time: z.string().optional()
});
export type CompanyInfoResponse = z.infer<typeof CompanyInfoSchema>;

const AccountBasedExpenseLineDetailSchema = z.object({
    AccountRef: RefSchema,
    TaxCodeRef: RefSchema.optional(),
    CustomerRef: RefSchema.optional(),
    BillableStatus: z.string().optional()
});

// Read-side: QBO returns multiple line detail types (AccountBasedExpenseLineDetail,
// ItemBasedExpenseLineDetail, SubTotalLineDetail, etc.). We accept any DetailType
// string and let through unknown fields so `search_purchases` works against real
// data. Write-side validation lives in `buildPurchasePayload`, which always
// constructs AccountBasedExpenseLineDetail directly.
const PurchaseLineSchema = z.object({
    Id: z.string().optional(),
    Amount: z.number(),
    Description: z.string().optional(),
    DetailType: z.string(),
    AccountBasedExpenseLineDetail: AccountBasedExpenseLineDetailSchema.optional()
}).passthrough();

export const PurchaseSchema = z.object({
    Id: z.string(),
    SyncToken: z.string(),
    TxnDate: z.string(),
    PaymentType: z.enum(["Cash", "Check", "CreditCard"]),
    AccountRef: RefSchema,
    EntityRef: z.object({
        value: z.string(),
        name: z.string().optional(),
        type: z.enum(["Vendor", "Employee", "Customer"]).optional()
    }).optional(),
    CurrencyRef: RefSchema.optional(),
    ExchangeRate: z.number().optional(),
    TotalAmt: z.number(),
    HomeTotalAmt: z.number().optional(),
    PrivateNote: z.string().optional(),
    DocNumber: z.string().optional(),
    Line: z.array(PurchaseLineSchema),
    MetaData: MetaDataSchema,
    status: z.string().optional()
});
export type Purchase = z.infer<typeof PurchaseSchema>;

export const PurchaseResponseSchema = z.object({
    Purchase: PurchaseSchema,
    time: z.string().optional()
});

export const PurchaseQueryResponseSchema = z.object({
    QueryResponse: z.object({
        Purchase: z.array(PurchaseSchema).optional(),
        startPosition: z.number().optional(),
        maxResults: z.number().optional(),
        totalCount: z.number().optional()
    }),
    time: z.string().optional()
});
export type PurchaseQueryResponse = z.infer<typeof PurchaseQueryResponseSchema>;

export const AttachableSchema = z.object({
    Id: z.string(),
    SyncToken: z.string().optional(),
    FileName: z.string().optional(),
    ContentType: z.string().optional(),
    Size: z.number().optional(),
    AttachableRef: z.array(z.object({
        EntityRef: z.object({
            type: z.string(),
            value: z.string()
        })
    })).optional()
});
export type Attachable = z.infer<typeof AttachableSchema>;
