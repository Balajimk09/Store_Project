import Link from 'next/link';
import {
  Zap,
  BarChart3,
  ShieldAlert,
  Sparkles,
  Receipt,
  BookOpen,
  TrendingUp,
  Clock,
  Check,
  ArrowRight,
  Store,
  DollarSign,
  Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

const features = [
  {
    icon: BarChart3,
    title: 'Real-time Dashboard',
    desc: 'Track sales, transactions, refunds, voids, and no-sales the moment they happen — no waiting for end-of-day reports.',
    color: 'text-chart-1',
    bg: 'bg-chart-1/10',
  },
  {
    icon: ShieldAlert,
    title: 'Cashier Risk Scoring',
    desc: 'Automatic risk scores flag cashiers with unusually high refunds, voids, or no-sale events before losses add up.',
    color: 'text-chart-6',
    bg: 'bg-chart-6/10',
  },
  {
    icon: Sparkles,
    title: 'AI Assistant',
    desc: 'Ask plain-English questions: "Why did sales drop?" or "Which products should I reorder?" Get instant answers from your data.',
    color: 'text-chart-2',
    bg: 'bg-chart-2/10',
  },
  {
    icon: Receipt,
    title: 'Live Transactions',
    desc: 'Every sale, refund, and void streams into a searchable table filtered by cashier, payment, and transaction type.',
    color: 'text-chart-4',
    bg: 'bg-chart-4/10',
  },
  {
    icon: BookOpen,
    title: 'Smart Pricebook',
    desc: 'Manage UPCs, costs, and margins in one place. See instantly which products are underpriced or overstocked.',
    color: 'text-chart-3',
    bg: 'bg-chart-3/10',
  },
  {
    icon: TrendingUp,
    title: 'Automated Reports',
    desc: 'Daily and weekly summaries with AI-generated insights, ready to export CSV and share with your team.',
    color: 'text-chart-5',
    bg: 'bg-chart-5/10',
  },
];

const pricing = [
  {
    name: 'Starter',
    price: '$49',
    period: '/mo',
    desc: 'For a single store just getting started with data.',
    features: ['1 store location', 'Up to 3 registers', 'Daily dashboard', 'CSV upload', '30-day history', 'Email support'],
    cta: 'Start free trial',
    highlight: false,
  },
  {
    name: 'Professional',
    price: '$99',
    period: '/mo',
    desc: 'For busy stores that want the full AI toolkit.',
    features: [
      '1 store location',
      'Unlimited registers',
      'Full dashboard + charts',
      'Cashier risk scoring',
      'AI assistant',
      'Automated weekly reports',
      '90-day history',
      'Priority support',
    ],
    cta: 'Start free trial',
    highlight: true,
  },
  {
    name: 'Multi-Store',
    price: 'Custom',
    period: '',
    desc: 'For operators managing several locations.',
    features: [
      'Unlimited locations',
      'Roll-up reporting',
      'Multi-store cashier audit',
      'Custom AI insights',
      'API + data export',
      'Dedicated account manager',
      'SSO + audit logs',
    ],
    cta: 'Contact sales',
    highlight: false,
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-lg">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary shadow-lg shadow-primary/30">
              <Zap className="h-5 w-5 text-white" />
            </div>
            <span className="text-lg font-semibold tracking-tight">StorePulse AI</span>
          </div>
          <nav className="hidden items-center gap-8 md:flex">
            <a href="#features" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              Features
            </a>
            <a href="#how" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              How it works
            </a>
            <a href="#pricing" className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
              Pricing
            </a>
          </nav>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild className="hidden sm:inline-flex">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
            <Link href="/demo-request">Request Demo</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-primary/5 via-background to-background" />
        <div
          className="absolute left-1/2 top-0 -z-10 h-[480px] w-[900px] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
          style={{ background: 'radial-gradient(circle, hsl(var(--primary) / 0.3), transparent 70%)' }}
        />
        <div className="mx-auto max-w-7xl px-4 pb-20 pt-16 sm:px-6 lg:px-8 lg:pb-28 lg:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm animate-fade-in">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
              </span>
              Now with AI-powered restocking alerts
            </div>
            <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl lg:text-6xl animate-slide-up">
              AI-powered back office for{' '}
              <span className="bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">convenience stores</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg text-muted-foreground animate-slide-up">
              StorePulse AI connects to your POS and turns raw transaction data into real-time sales insight, cashier fraud
              detection, and an AI assistant that answers your hardest questions — all in one clean dashboard.
            </p>
            <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row animate-slide-up">
              <Button size="lg" asChild className="h-12 px-8 text-base shadow-lg shadow-primary/25">
                <Link href="/demo-request">
                  Request a demo <ArrowRight className="ml-2 h-4 w-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild className="h-12 px-8 text-base">
                <a href="#how">See how it works</a>
             </Button>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">No credit card required · Set up in under 10 minutes</p>
          </div>

          {/* Hero stat strip */}
          <div className="mx-auto mt-16 grid max-w-4xl grid-cols-2 gap-4 sm:grid-cols-4">
            {[
              { icon: DollarSign, label: 'Avg. sales lift', value: '+12%' },
              { icon: Clock, label: 'Time saved / week', value: '8 hrs' },
              { icon: ShieldAlert, label: 'Fraud detected', value: '98%' },
              { icon: Activity, label: 'Transactions / day', value: '540+' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-border bg-card p-4 text-center shadow-sm">
                <stat.icon className="mx-auto mb-2 h-5 w-5 text-primary" />
                <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                <p className="text-xs text-muted-foreground">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-t border-border/60 bg-secondary/30 py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Features</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
              Everything you need to run a smarter store
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Built for independent gas stations and c-stores. No spreadsheets, no nightly exports — just clarity.
            </p>
          </div>

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((feature) => (
              <div
                key={feature.title}
                className="group rounded-2xl border border-border bg-card p-6 shadow-sm transition-all hover:-translate-y-1 hover:shadow-md"
              >
                <div className={`mb-4 inline-flex h-11 w-11 items-center justify-center rounded-xl ${feature.bg} ${feature.color}`}>
                  <feature.icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-foreground">{feature.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">How it works</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Live in three simple steps</h2>
          </div>
          <div className="mt-14 grid gap-8 md:grid-cols-3">
            {[
              {
                step: '01',
                title: 'Upload your POS data',
                desc: 'Drag in a transactions CSV from your register, or connect your POS sync. We handle Verifone, Gilbarco, and more.',
                icon: Receipt,
              },
              {
                step: '02',
                title: 'We analyze every transaction',
                desc: 'StorePulse AI categorizes sales, flags suspicious cashier activity, and calculates margins in real time.',
                icon: Activity,
              },
              {
                step: '03',
                title: 'Ask questions, get answers',
                desc: 'Open the AI assistant and ask "Which products should I reorder?" — get a plain-English answer instantly.',
                icon: Sparkles,
              },
            ].map((item) => (
              <div key={item.step} className="relative rounded-2xl border border-border bg-card p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <item.icon className="h-5 w-5" />
                  </div>
                  <span className="text-3xl font-bold text-border">{item.step}</span>
                </div>
                <h3 className="text-lg font-semibold text-foreground">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="border-t border-border/60 bg-secondary/30 py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-primary">Pricing</p>
            <h2 className="mt-2 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Simple pricing that scales with you</h2>
            <p className="mt-4 text-lg text-muted-foreground">14-day free trial on every plan. Cancel anytime.</p>
          </div>

          <div className="mt-14 grid gap-6 lg:grid-cols-3">
            {pricing.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl border bg-card p-8 shadow-sm ${
                  plan.highlight ? 'border-primary shadow-lg shadow-primary/15 ring-1 ring-primary' : 'border-border'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-primary px-4 py-1 text-xs font-semibold text-primary-foreground shadow">
                    Most popular
                  </div>
                )}
                <h3 className="text-lg font-semibold text-foreground">{plan.name}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{plan.desc}</p>
                <div className="mt-5 flex items-baseline gap-1">
                  <span className="text-4xl font-bold tracking-tight text-foreground">{plan.price}</span>
                  <span className="text-sm text-muted-foreground">{plan.period}</span>
                </div>
                <Button
                  asChild
                  className="mt-6 w-full"
                  variant={plan.highlight ? 'default' : 'outline'}
                >
                  <Link href="/app/dashboard">{plan.cta}</Link>
                </Button>
                <ul className="mt-8 space-y-3">
                  {plan.features.map((feat) => (
                    <li key={feat} className="flex items-start gap-3 text-sm">
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                      <span className="text-muted-foreground">{feat}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 lg:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="relative overflow-hidden rounded-3xl bg-sidebar px-6 py-16 text-center shadow-xl sm:px-16">
            <div
              className="absolute inset-0 -z-10 opacity-40 blur-3xl"
              style={{ background: 'radial-gradient(circle at 30% 20%, hsl(var(--primary) / 0.5), transparent 60%)' }}
            />
            <Store className="mx-auto mb-6 h-10 w-10 text-primary" />
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
              Stop guessing. Start running your store on data.
            </h2>
            <p className="mx-auto mt-4 max-w-xl text-base text-sidebar-foreground/70">
              Join hundreds of independent c-store operators using StorePulse AI to catch fraud, boost margins, and save hours every week.
            </p>
            <Button size="lg" asChild className="mt-8 h-12 px-8 text-base shadow-lg">
              <Link href="/app/dashboard">
                Request a demo <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border bg-secondary/30">
        <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
                <Zap className="h-4 w-4 text-white" />
              </div>
              <span className="font-semibold tracking-tight">StorePulse AI</span>
            </div>
            <p className="text-sm text-muted-foreground">Built for independent gas stations &amp; convenience stores.</p>
            <p className="text-sm text-muted-foreground">© 2026 StorePulse AI</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
