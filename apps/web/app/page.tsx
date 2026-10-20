import { SignIn, UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import FinanceApp from "./finance-app";
import { isWorkspaceOwner } from "../lib/hosted-access";
export const dynamic = "force-dynamic";
export default async function Home() {
  if (process.env.JAYE_MODE !== "hosted") return <FinanceApp />;
  const user = await currentUser();
  if (!user)
    return (
      <main className="hosted-sign-in">
        <img src="/brand/jaye.svg" alt="Jaye" width={90} />
        <h1>Sign in to Jaye Finance</h1>
        <p>Your company’s expenses, salaries and records in one place.</p>
        <SignIn routing="hash" />
      </main>
    );
  if (!isWorkspaceOwner(user, process.env.JAYE_OWNER_EMAIL))
    return (
      <main className="hosted-sign-in">
        <UserButton />
        <h1>This workspace is private</h1>
        <p>
          Sign in with the workspace owner’s verified email address to continue.
        </p>
      </main>
    );
  return (
    <>
      <div className="hosted-user">
        <UserButton />
      </div>
      <FinanceApp />
    </>
  );
}
