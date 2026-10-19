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
import type { Request, Response } from "express";
import { FinanceStore, DomainError, csv } from "./domain";
import { resolve } from "node:path";

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
  actor(req: Request) {
    return this.store.session(token(req));
  }
  @Get("health") health() {
    return {
      status: "ok",
      mode: "local-shadow",
      data: "synthetic",
      productionReady: false,
    };
  }
  @Get("demo/users") users() {
    return this.store.users();
  }
  @Post("demo/login") login(@Body() input: any, @Res() res: Response) {
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
    return this.store.budgets(this.actor(req), entity);
  }
  @Get("journals") journals(
    @Req() req: Request,
    @Query("entity") entity: string,
  ) {
    return this.store.journals(this.actor(req), entity);
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
        ],
        rows.map((r) => [
          r.id,
          r.date,
          r.vendor,
          r.description,
          r.amount_minor,
          r.currency,
          r.status,
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
        "Content-Disposition": `attachment; filename="SYNTHETIC-jaye-${entity}-${type}.csv"`,
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
  if (
    process.env.NODE_ENV === "production" ||
    process.env.JAYE_MODE === "production"
  )
    throw new Error(
      "Local shadow build cannot run as production. Complete the controls in OPEN_DECISIONS.md first.",
    );
  const app = await NestFactory.create(
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
            ),
        },
      ],
    },
    { logger: process.env.JAYE_TEST ? false : ["warn", "error", "log"] },
  );
  app.useGlobalFilters(new Errors());
  app.use((req: Request, res: Response, next: () => void) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
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
  await app.listen(3001, "127.0.0.1");
  console.log(
    "Jaye Finance API: http://127.0.0.1:3001/api/health · SYNTHETIC SHADOW MODE",
  );
}
if (require.main === module) bootstrap();
