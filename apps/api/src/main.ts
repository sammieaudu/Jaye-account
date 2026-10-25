import { InvoiceService } from "./invoices";
import { hostedMode, validateHosting, validServiceKey } from "./hosted";
import { BookkeepingService } from "./bookkeeping";
import { RecoveryService } from "./recoveries";
import { AdjustmentService } from "./adjustments";
import { ReportingService } from "./reporting";
import { SubscriptionService } from "./subscriptions";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  Controller,
  Module,
  Get,
  Post,
  Param,
  Query,
  Body,
  Req,
  Res,
  Inject,
  UseInterceptors,
  UploadedFile,
  Catch,
  ArgumentsHost,
  ExceptionFilter,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { Request, Response } from "express";
import { FinanceStore, DomainError, csv } from "./domain";
import { resolve } from "node:path";
import { BudgetService } from "./budgets";
import { FinancialService } from "./financial/service";
import { exportFinancialWorkbook } from "./financial/workbook";

const STORE = "STORE";
function token(req: Request) {
  return (
    req.headers.cookie
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith("jaye_session="))
      ?.slice(13) || ""
  );
}
@Catch()
class Errors implements ExceptionFilter {
  catch(err: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      err instanceof DomainError ? err.status : err.getStatus?.() || 400;
    const message =
      err instanceof DomainError
        ? err.message
        : err.code?.startsWith("SQLITE")
          ? "Operation blocked by a database integrity constraint"
          : err.message?.includes("UNIQUE constraint")
            ? "Duplicate invoice, payment reference or converted request"
            : err.message?.includes("constraint")
              ? "Operation blocked by a database integrity constraint"
              : status === 413
                ? "File exceeds the 8 MB limit"
                : "Request could not be completed";
    res.status(status).json({ message });
  }
}
@Controller("api")
class Api {
  constructor(@Inject(STORE) private readonly store: FinanceStore) {}
  financialActor(req: Request) {
    if (!hostedMode()) return this.actor(req);
    if (!validServiceKey(req.headers["x-jaye-service-key"]))
      throw new DomainError("Authenticated gateway required", 401);
    const identity = req.headers["x-jaye-user-id"];
    if (
      typeof identity !== "string" ||
      !/^user_[a-zA-Z0-9]{1,120}$/.test(identity)
    )
      throw new DomainError("Verified personal identity required", 401);
    const editors = (process.env.JAYE_FINANCIAL_EDITORS || "")
      .split(",")
      .filter(Boolean);
    const role =
      editors.length && !editors.includes(identity) ? "auditor" : "finance";
    const id = `hosted:${identity}`;
    this.store.run(
      "INSERT INTO users(id,name,role,entities) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET role=excluded.role",
      id,
      "Workspace member",
      role,
      JSON.stringify(["ng"]),
    );
    return this.store.actor(id);
  }
  @Get("financial/contract") financialContract(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return new FinancialService(this.store).contract(
      this.financialActor(req),
      entity,
    );
  }
  @Get("financial/workspace") financialWorkspace(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Query("scenario") scenario: string,
  ) {
    return new FinancialService(this.store).workspace(
      this.financialActor(req),
      entity,
      scenario || "base",
    );
  }
  @Post("financial/resources") financialSave(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Body() input: any,
  ) {
    return new FinancialService(this.store).save(
      this.financialActor(req),
      entity,
      input,
    );
  }
  @Post("financial/resources/:id/action") financialAction(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new FinancialService(this.store).action(
      this.financialActor(req),
      entity,
      id,
      input,
    );
  }
  @Get("financial/history/:id") financialHistory(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Param("id") id: string,
  ) {
    return new FinancialService(this.store).history(
      this.financialActor(req),
      entity,
      id,
    );
  }
  @Get("financial/imports/:id") financialImportRead(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Param("id") id: string,
  ) {
    return new FinancialService(this.store).readImport(
      this.financialActor(req),
      entity,
      id,
    );
  }
  @Post("financial/imports/:id/replace") financialImportReplace(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new FinancialService(this.store).replaceDraft(
      this.financialActor(req),
      entity,
      id,
      input,
    );
  }
  @Post("financial/imports/preview") financialPreview(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Body() input: any,
  ) {
    return new FinancialService(this.store).preview(
      this.financialActor(req),
      entity,
      input,
    );
  }
  @Post("financial/imports/:id/accept") financialAccept(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new FinancialService(this.store).accept(
      this.financialActor(req),
      entity,
      id,
      input,
    );
  }
  @Post("financial/imports/:id/discard") financialDiscard(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Param("id") id: string,
  ) {
    return new FinancialService(this.store).discard(
      this.financialActor(req),
      entity,
      id,
    );
  }
  @Post("financial/snapshots") financialSnapshot(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Body() input: any,
  ) {
    return new FinancialService(this.store).snapshot(
      this.financialActor(req),
      entity,
      input,
    );
  }
  @Get("financial/snapshots/:id") financialSnapshotRead(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Param("id") id: string,
  ) {
    return new FinancialService(this.store).snapshotData(
      this.financialActor(req),
      entity,
      id,
    );
  }
  @Get("financial/snapshots/:id/excel") async financialExcel(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const snap = new FinancialService(this.store).snapshotData(
      this.financialActor(req),
      entity,
      id,
    );
    const bytes = await exportFinancialWorkbook(
      snap.input,
      id,
      snap.scenario_id,
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="jaye-financial-model-${id}.xlsx"`,
    );
    res.send(Buffer.from(bytes));
  }
  actor(req: Request) {
    if (hostedMode()) {
      if (!validServiceKey(req.headers["x-jaye-service-key"]))
        throw new DomainError("Authenticated gateway required", 401);
      return this.store.actor("finance");
    }
    return this.store.session(token(req));
  }
  @Get("health") health() {
    return {
      status: "ok",
      mode: hostedMode() ? "hosted" : "local-shadow",
      data: "workspace",
      productionReady: false,
    };
  }
  @Get("demo/users") users() {
    if (hostedMode()) throw new DomainError("Local sign-in is disabled", 403);
    return this.store.users();
  }
  @Post("demo/login") login(@Body() input: any, @Res() res: Response) {
    if (hostedMode()) throw new DomainError("Local sign-in is disabled", 403);
    const { token, user } = this.store.login(input.user_id);
    res.cookie("jaye_session", token, {
      httpOnly: true,
      sameSite: "strict",
      path: "/",
      maxAge: 8 * 60 * 60 * 1000,
    });
    return res.json({ user, mode: "local-shadow" });
  }
  @Post("logout") logout(@Req() req: Request, @Res() res: Response) {
    this.store.logout(token(req));
    res.clearCookie("jaye_session", { path: "/" }).json({ ok: true });
  }
  @Get("me") me(@Req() req: Request) {
    return { user: this.actor(req), mode: "local-shadow" };
  }
  @Get("entities") entities(@Req() req: Request) {
    return this.store.entities(this.actor(req));
  }
  @Get("sales-invoices") salesInvoices(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return new InvoiceService(this.store).list(this.actor(req), entity);
  }
  @Post("sales-invoices") saveSalesInvoice(
    @Req() req: Request,
    @Body() input: any,
  ) {
    return new InvoiceService(this.store).save(this.actor(req), input);
  }
  @Post("sales-invoices/:id/edit") editSalesInvoice(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new InvoiceService(this.store).save(this.actor(req), input, id);
  }
  @Post("sales-invoices/:id/action") actionSalesInvoice(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new InvoiceService(this.store).action(this.actor(req), id, input);
  }
  @Post("sales-invoices/:id/payments") invoicePayment(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new InvoiceService(this.store).payment(this.actor(req), id, input);
  }
  @Post("sales-invoices/:id/payments/:paymentId/void") voidInvoicePayment(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("paymentId") paymentId: string,
    @Body() input: any,
  ) {
    return new InvoiceService(this.store).voidPayment(
      this.actor(req),
      id,
      paymentId,
      input,
    );
  }
  @Get("categories") categories(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return this.store.categoryList(this.actor(req), entity);
  }
  @Post("categories") addCategory(@Req() req: Request, @Body() input: any) {
    return this.store.addCategory(this.actor(req), input);
  }
  @Get("dashboard") dashboard(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return this.store.dashboard(this.actor(req), entity);
  }
  @Get("spends") spends(@Req() req: Request, @Query("entity") entity: string) {
    return this.store.list(this.actor(req), entity);
  }
  @Post("spends") create(@Req() req: Request, @Body() input: any) {
    return this.store.createSpend(this.actor(req), input);
  }
  @Get("spends/:id") details(@Req() req: Request, @Param("id") id: string) {
    return this.store.details(this.actor(req), id);
  }
  @Post("spends/:id/edit") edit(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return this.store.updateSpend(this.actor(req), id, input);
  }
  @Post("records/:id/attachments")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }),
  )
  recordAttachment(
    @Req() req: Request,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return new BookkeepingService(this.store).attach(this.actor(req), id, file);
  }
  @Get("record-attachments/:id")
  readRecordAttachment(
    @Req() req: Request,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const f = new BookkeepingService(this.store).attachment(
      this.actor(req),
      id,
    );
    res.set({
      "Content-Type": f.mime,
      "Content-Disposition": `attachment; filename="${f.filename}"`,
    });
    res.send(f.content);
  }
  @Post("records/:id/correct") correctRecord(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new BookkeepingService(this.store).correct(
      this.actor(req),
      "record",
      id,
      input,
    );
  }
  @Post("record-payments/:id/correct") correctRecordPayment(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new BookkeepingService(this.store).correct(
      this.actor(req),
      "payment",
      id,
      input,
    );
  }
  @Get("employees") employees(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return new BookkeepingService(this.store).employees(
      this.actor(req),
      entity,
    );
  }
  @Post("employees") saveEmployee(@Req() req: Request, @Body() input: any) {
    return new BookkeepingService(this.store).saveEmployee(
      this.actor(req),
      input,
    );
  }
  @Post("employees/:id/edit") editEmployee(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new BookkeepingService(this.store).saveEmployee(
      this.actor(req),
      input,
      id,
    );
  }
  @Get("records") records(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return new BookkeepingService(this.store).list(this.actor(req), entity);
  }
  @Get("records/:id") record(@Req() req: Request, @Param("id") id: string) {
    return new BookkeepingService(this.store).detail(this.actor(req), id);
  }
  @Post("records") recordExpense(@Req() req: Request, @Body() input: any) {
    return new BookkeepingService(this.store).record(this.actor(req), input);
  }
  @Post("records/:id/payments") recordPayment(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new BookkeepingService(this.store).pay(this.actor(req), id, input);
  }
  @Post("records/:id/refunds") recordRefund(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new BookkeepingService(this.store).refund(
      this.actor(req),
      id,
      input,
    );
  }
  @Post("records/:id/refunds/:fid/reverse") reverseRecordRefund(
    @Req() req: Request,
    @Param("id") id: string,
    @Param("fid") fid: string,
    @Body() input: any,
  ) {
    return new BookkeepingService(this.store).reverseRefund(
      this.actor(req),
      id,
      fid,
      input,
    );
  }
  @Post("records/:id/bank-match") matchRecordBank(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new BookkeepingService(this.store).matchBank(
      this.actor(req),
      id,
      input,
    );
  }
  @Get("subscriptions") subscriptions(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Query("days") days?: string,
  ) {
    return new SubscriptionService(this.store).list(
      this.actor(req),
      entity,
      days ? Number(days) : 90,
    );
  }
  @Post("subscriptions") createSubscription(
    @Req() req: Request,
    @Body() input: any,
  ) {
    return new SubscriptionService(this.store).save(this.actor(req), input);
  }
  @Post("subscriptions/:id/edit") editSubscription(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new SubscriptionService(this.store).save(this.actor(req), input, id);
  }
  @Post("subscriptions/:id/action") subscriptionAction(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new SubscriptionService(this.store).action(
      this.actor(req),
      id,
      input,
    );
  }
  @Post("subscriptions/:id/expenses") subscriptionExpense(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new SubscriptionService(this.store).recordExpense(
      this.actor(req),
      id,
      input,
    );
  }
  @Post("subscriptions/:id/invoices") subscriptionInvoice(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new SubscriptionService(this.store).record(
      this.actor(req),
      id,
      input,
    );
  }
  @Get("reimbursements") reimbursements(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return this.store.reimbursements(this.actor(req), entity);
  }
  @Post("reimbursements") createClaim(@Req() req: Request, @Body() input: any) {
    return this.store.saveClaim(this.actor(req), input);
  }
  @Get("reimbursements/:id") claim(
    @Req() req: Request,
    @Param("id") id: string,
  ) {
    return this.store.claim(this.actor(req), id);
  }
  @Post("reimbursements/:id/edit") editClaim(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return this.store.saveClaim(this.actor(req), input, id);
  }
  @Post("reimbursements/:id/action") claimAction(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return this.store.claimAction(this.actor(req), id, input);
  }
  @Post("reimbursements/:id/repayments") scheduleRepayment(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return this.store.scheduleRepayment(this.actor(req), id, input);
  }
  @Post("repayments/:id/action") repaymentAction(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return this.store.repaymentAction(this.actor(req), id, input);
  }
  @Post("spends/:id/action") action(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    if (
      typeof input.action !== "string" ||
      (input.comment !== undefined && typeof input.comment !== "string") ||
      (input.reference !== undefined && typeof input.reference !== "string")
    )
      throw new DomainError("Invalid action input");
    return this.store.action(this.actor(req), id, input.action, {
      comment: input.comment,
      reference: input.reference,
    });
  }
  @Post("spends/:id/receipt")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 8 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @Req() req: Request,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new DomainError("Choose a receipt file");
    return this.store.upload(this.actor(req), id, file);
  }
  @Get("receipts/:id") receipt(
    @Req() req: Request,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const r = this.store.receipt(this.actor(req), id);
    res.set({
      "Content-Type": r.mime,
      "Content-Disposition": `attachment; filename="${r.filename}"`,
      "Cache-Control": "no-store",
    });
    res.send(r.content);
  }
  @Get("vendors") vendors(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return this.store.vendors(this.actor(req), entity);
  }
  @Post("vendors") vendor(@Req() req: Request, @Body() input: any) {
    return this.store.createVendor(this.actor(req), input);
  }
  @Get("budgets") budgets(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return new BudgetService(this.store).list(
      this.financialActor(req),
      entity,
      req.query.archived === "1",
    );
  }
  @Get("budgets/access") budgetAccess(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    const a = this.financialActor(req);
    this.store.authorize(a, entity, ["manager", "finance", "cfo", "auditor"]);
    return { can_write: ["finance", "cfo"].includes(a.role) };
  }
  @Post("budgets") createBudget(@Req() req: Request, @Body() input: any) {
    return new BudgetService(this.store).save(this.financialActor(req), input);
  }
  @Post("budgets/:id") updateBudget(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new BudgetService(this.store).save(
      this.financialActor(req),
      input,
      id,
    );
  }
  @Post("budgets/:id/action") budgetAction(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: any,
  ) {
    return new BudgetService(this.store).action(
      this.financialActor(req),
      id,
      input,
    );
  }
  @Get("budgets/:id/history") budgetHistory(
    @Req() req: Request,
    @Param("id") id: string,
    @Query("entity") entity: string,
  ) {
    return new BudgetService(this.store).history(
      this.financialActor(req),
      entity,
      id,
    );
  }
  @Get("journals") journals(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return this.store.journals(this.actor(req), entity);
  }
  @Get("reports/operations") operations(
    @Req() req: Request,
    @Query("entity") entity: string,
    @Query("days") days?: string,
  ) {
    return new ReportingService(this.store).report(
      this.actor(req),
      entity,
      days ? Number(days) : 90,
    );
  }
  @Get("recoveries") recoveries(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return new RecoveryService(this.store).list(this.actor(req), entity);
  }
  @Post("recoveries") createRecovery(
    @Req() req: Request,
    @Body() input: unknown,
  ) {
    return new RecoveryService(this.store).create(this.actor(req), input);
  }
  @Post("recoveries/:id/action") recoveryAction(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return new RecoveryService(this.store).action(this.actor(req), id, input);
  }
  @Post("adjustments") createAdjustment(
    @Req() req: Request,
    @Body() input: unknown,
  ) {
    return new AdjustmentService(this.store).create(this.actor(req), input);
  }
  @Post("adjustments/:id/action") adjustmentAction(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return new AdjustmentService(this.store).action(this.actor(req), id, input);
  }
  @Post("refunds") createRefund(@Req() req: Request, @Body() input: unknown) {
    return new ReportingService(this.store).createRefund(
      this.actor(req),
      input,
    );
  }
  @Post("refunds/:id/action") refundAction(
    @Req() req: Request,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return new ReportingService(this.store).refundAction(
      this.actor(req),
      id,
      input,
    );
  }
  @Get("reports/trial-balance") trial(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return this.store.trialBalance(this.actor(req), entity);
  }
  @Get("audit") audit(@Req() req: Request, @Query("entity") entity: string) {
    return this.store.auditLog(this.actor(req), entity);
  }
  @Get("exports/:type") exports(
    @Req() req: Request,
    @Param("type") type: string,
    @Query("entity") entity: string,
    @Res() res: Response,
  ) {
    const a = this.actor(req);
    let out = "";
    if (type === "payments") out = this.store.paymentFile(a, entity);
    else if (type === "spend") {
      const rows = this.store.list(a, entity);
      out = csv(
        [
          "id",
          "date",
          "vendor",
          "description",
          "amount_minor",
          "currency",
          "status",
          "approval_status",
          "settlement_status",
          "payment_source",
          "paid_by_id",
          "requester",
          "department",
          "category",
          "purpose",
          "invoice_number",
          "invoice_date",
          "due_date",
          "original_paid_date",
          "payment_method",
          "payment_account",
          "original_payment_reference",
          "outstanding_minor",
          "adjustment_minor",
          "effective_amount_minor",
          "recoverable_minor",
          "receipt_count",
        ],
        rows.map((r) => [
          r.id,
          r.date,
          r.vendor,
          r.description,
          r.amount_minor,
          r.currency,
          r.status,
          r.approval_status,
          r.settlement_status,
          r.payment_source,
          r.paid_by_id,
          r.requester,
          r.department,
          r.category,
          r.purpose,
          r.invoice_number,
          r.invoice_date,
          r.due_date,
          r.original_paid_date,
          r.payment_method,
          r.payment_account,
          r.original_payment_reference,
          r.outstanding_minor,
          r.adjustment_minor,
          r.effective_amount_minor,
          r.recoverable_minor,
          r.receipt_count,
        ]),
      );
    } else if (type === "trial-balance") {
      const rows = this.store.trialBalance(a, entity);
      out = csv(
        ["code", "account", "debit_minor", "credit_minor", "balance_minor"],
        rows.map((r) => [r.code, r.name, r.debit, r.credit, r.balance]),
      );
    } else throw new DomainError("Unknown export", 404);
    res
      .set({
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="jaye-${entity}-${type}.csv"`,
        "Cache-Control": "no-store",
      })
      .send(out);
  }
  @Get("banking/transactions") bankRows(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return this.store.bankTransactions(this.actor(req), entity);
  }
  @Post("banking/import") importBank(@Req() req: Request, @Body() input: any) {
    return this.store.importStatement(
      this.actor(req),
      input.entity_id,
      input.csv,
    );
  }
  @Get("investor/snapshots") snapshots(@Req() req: Request) {
    const a = this.actor(req);
    if (!["investor", "cfo"].includes(a.role))
      throw new DomainError("Investor or CFO role required", 403);
    return {
      snapshots: [],
      reason:
        "No CFO-approved snapshots. Consolidation and snapshot approval are gated until Phase 2.",
    };
  }
}
@Module({ controllers: [Api] })
class AppModule {}
export async function createFinanceApp(store?: FinanceStore) {
  validateHosting();
  const app = await NestFactory.create<NestExpressApplication>(
    {
      module: AppModule,
      providers: [
        {
          provide: STORE,
          useFactory: () =>
            store ||
            new FinanceStore(
              process.env.JAYE_DB_PATH ||
                resolve(__dirname, "../../../data/jaye.db"),
              "empty",
              "ng",
            ),
        },
      ],
    },
    { logger: process.env.JAYE_TEST ? false : ["warn", "error", "log"] },
  );
  app.useBodyParser("json", { limit: "6mb" });
  app.useGlobalFilters(new Errors());
  app.use((req: Request, res: Response, next: () => void) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    if (hostedMode()) {
      if (req.path === "/api/health" && req.method === "GET") {
        next();
        return;
      }
      if (!validServiceKey(req.headers["x-jaye-service-key"])) {
        res.status(401).json({ message: "Authenticated gateway required" });
        return;
      }
      if (req.path.startsWith("/api/demo/")) {
        res.status(403).json({ message: "Local sign-in is disabled" });
        return;
      }
      next();
      return;
    }
    const origin = req.headers.origin;
    if (
      req.method !== "GET" &&
      req.method !== "HEAD" &&
      origin &&
      !["http://127.0.0.1:3000", "http://localhost:3000"].includes(origin)
    ) {
      res.status(403).json({ message: "Cross-origin mutation blocked" });
      return;
    }
    next();
  });
  return app;
}
async function bootstrap() {
  const app = await createFinanceApp();
  await app.listen(
    Number(process.env.PORT || 3001),
    hostedMode() ? "0.0.0.0" : "127.0.0.1",
  );
  console.log(
    hostedMode()
      ? "Jaye Finance API: authenticated hosted workspace"
      : "Jaye Finance API: http://127.0.0.1:3001/api/health · LOCAL WORKSPACE",
  );
}
if (require.main === module) bootstrap();
