// The 2026-27 program page — editable content.
// Peter edits here; the page markup does not need to change.

export const workshopDates = [
  { label: "SEP 19", kickoff: true }, { label: "OCT 3" }, { label: "OCT 17" }, { label: "NOV 7", mark: "\u2605" },
  { label: "NOV 21" }, { label: "DEC 5" }, { label: "DEC 19" }, { label: "JAN 9" },
  { label: "JAN 23" }, { label: "FEB 6" }, { label: "FEB 20" }, { label: "MAR 6", mark: "\u2605" },
  { label: "MAR 20" }, { label: "APR 3" }, { label: "APR 17" }, { label: "MAY 1" },
  { label: "MAY 15" }, { label: "JUN 5", mark: "\u2605" }, { label: "JUN 19", mark: "\u2605" }, { label: "SPECIAL", tbd: true },
];

export const dateNotes = [
  "\u2605 Demo Day Workshops, where kids present their businesses on stage for the cohort and parents.",
  "The year kicks off Saturday, September 19, and pauses over the winter holidays, resuming January 9.",
  "Plus one special session to be added later as the year progresses.",
];

export const pathSteps = [
  {
    num: "01", key: "SELL", title: "Sell", subtitle: "Learn to confidently sell anything.",
    principle: "Entrepreneurship starts with a stranger saying yes. Before your child builds anything, they learn to sell something.",
    criteria: [
      "Pitch a product in 60 seconds to an adult who isn't family, without notes.",
      "Make a real sale: a real customer who isn't family, real money changing hands (could be a donation for a charity).",
      "Hear \u201cno\u201d at least three times and log what each no taught them.",
      "Explain cost, price, and profit for a product created by them, on one page.",
      "Complete 25 supervised outreach attempts: a booth, door to door, calls, or messages.",
    ],
    parentsSee: "Your child pitches you, then pitches strangers. The first sale usually happens faster than either of you expect.",
  },
  {
    num: "02", key: "BUILD", title: "Build", subtitle: "Make a real product with AI.",
    principle: "Your child stops being a user of technology and becomes a builder with it.",
    criteria: [
      "Ship a working product, site, or offer built with AI tools, with a live URL, pricing, and instructions on how to use the product.",
      "Explain in a 1-page brief how you connected your product to a gap you identified in an area you know something about (domain expertise).",
      "Contacted 40 potential customers. Launched one piece of marketing with metrics on how it worked.",
      "Ship a v2 that responds to feedback from at least three real users.",
      "Presented a 3-5 minute live demo, results from your build and what you learned about building a product.",
    ],
    parentsSee: "A link you can open. A thing that works. Built by your kid, with an AI co-founder, in days not months.",
  },
  {
    num: "03", key: "VALIDATE", title: "Validate", subtitle: "Test ideas like a scientist.",
    principle: "Most business ideas are wrong. The skill is finding out fast and cheap.",
    criteria: [
      "Ran at least 2 validation loops. Each one documents a hypothesis, runs a test and produces an outcome for each.",
      "Delivered a pricing experiment with documented price points, margin math and feedback from two groups of potential customers.",
      "Submitted an AI-tool audit showing selection, rationale, and outcome for at least 3 new tools adopted since Day 1 of The 120.",
      "Without any adult help, choose your own validation path. Present the reasoning and outcome on a Saturday.",
      "Publish two pieces of content (maybe through your parents' accounts) that attract external engagement: comments, shares, inbound, or citations and reposts.",
    ],
    parentsSee: "Your child stops defending ideas and starts testing them. This is the step where they learn to love being wrong quickly.",
  },
  {
    num: "04", key: "GROW", title: "Grow", subtitle: "Turn a validated idea into a running business.",
    principle: "One sale is a story. Repeat sales are a business.",
    criteria: [
      "10 sales or 3 repeat customers.",
      "Track a simple profit and loss statement for four consecutive weeks of active business activity.",
      "Create one daily or weekly repeating AI process, via Claude Cowork or an AI agent, that supports your business.",
      "Closed at least one real negotiation with documented terms.",
      "Present their financials to the cohort the way a founder presents to a board.",
    ],
    parentsSee: "A kid who can read their own P&L and tell you which week was best and why. Most adults can't.",
  },
  {
    num: "05", key: "SCALE", title: "Scale", subtitle: "Build systems so the business runs beyond them.",
    principle: "The final step is the founder's step: making the business bigger than one person's hours.",
    criteria: [
      "Automate one real part of the business with an AI agent or automation, and show it running.",
      "Delegate a task, to a friend, a sibling, or an AI agent, with written instructions that worked.",
      "Keep the business serving customers through a week they took off.",
      "Write the one-page playbook someone else could use to run it.",
      "Pitch what the business becomes next year, on stage, at an intensive.",
    ],
    parentsSee: "The end state of finishing The Path 1.0: a child who owns a small machine, not a chore. That's the founder's mindset, at whatever size.",
  },
];

export const bookTracks = [
  {
    id: "3-5", label: "GRADES 3\u20135",
    groups: [
      { step: "SELL", books: [
        { title: "The Lemonade War", author: "Jacqueline Davies" },
        { title: "Lunch Money", author: "Andrew Clements" },
        { title: "Charlotte's Web", author: "E.B. White" },
        { title: "Swindle", author: "Gordon Korman" },
      ]},
      { step: "BUILD", books: [
        { title: "The Toothpaste Millionaire", author: "Jean Merrill" },
        { title: "The Boy Who Harnessed the Wind (Young Readers)", author: "William Kamkwamba" },
        { title: "Frindle", author: "Andrew Clements" },
        { title: "The Wild Robot", author: "Peter Brown" },
      ]},
      { step: "VALIDATE", books: [
        { title: "Mistakes That Worked", author: "Charlotte Foltz Jones" },
        { title: "What Do You Do with an Idea?", author: "Kobi Yamada" },
        { title: "The Westing Game", author: "Ellen Raskin" },
        { title: "Hatchet", author: "Gary Paulsen" },
      ]},
      { step: "GROW", books: [
        { title: "How to Turn $100 into $1,000,000", author: "McKenna, Glista, Fontaine" },
        { title: "Kid Start-Up", author: "Mark Cuban" },
        { title: "Matilda", author: "Roald Dahl" },
        { title: "Holes", author: "Louis Sachar" },
      ]},
      { step: "SCALE", books: [
        { title: "The Phantom Tollbooth", author: "Norton Juster" },
        { title: "Wonder", author: "R.J. Palacio" },
        { title: "Charlie and the Chocolate Factory", author: "Roald Dahl" },
        { title: "Danny the Champion of the World", author: "Roald Dahl" },
      ]},
    ],
  },
  {
    id: "6-8", label: "GRADES 6\u20138",
    groups: [
      { step: "SELL", books: [
        { title: "How to Win Friends and Influence People", author: "Dale Carnegie" },
        { title: "The Go-Giver", author: "Bob Burg & John David Mann" },
        { title: "Rich Dad Poor Dad for Teens", author: "Robert Kiyosaki" },
        { title: "Better Than a Lemonade Stand", author: "Daryl Bernstein" },
      ]},
      { step: "BUILD", books: [
        { title: "Steve Jobs: The Man Who Thought Different", author: "Karen Blumenthal" },
        { title: "The Boy Who Harnessed the Wind", author: "William Kamkwamba" },
        { title: "Elon Musk and the Quest for a Fantastic Future (Young Readers)", author: "Ashlee Vance" },
        { title: "A Wrinkle in Time", author: "Madeleine L'Engle" },
      ]},
      { step: "VALIDATE", books: [
        { title: "The Martian (Classroom Edition)", author: "Andy Weir" },
        { title: "Atomic Habits", author: "James Clear" },
        { title: "Who Moved My Cheese?", author: "Spencer Johnson" },
        { title: "Chew On This", author: "Eric Schlosser & Charles Wilson" },
      ]},
      { step: "GROW", books: [
        { title: "Lawn Boy", author: "Gary Paulsen" },
        { title: "Shoe Dog (Young Readers)", author: "Phil Knight" },
        { title: "Start Something That Matters", author: "Blake Mycoskie" },
        { title: "The 7 Habits of Highly Effective Teens", author: "Sean Covey" },
      ]},
      { step: "SCALE", books: [
        { title: "Ender's Game", author: "Orson Scott Card" },
        { title: "The Giver", author: "Lois Lowry" },
        { title: "Animal Farm", author: "George Orwell" },
        { title: "The Alchemist", author: "Paulo Coelho" },
      ]},
    ],
  },
  {
    id: "9-12", label: "GRADES 9\u201312",
    groups: [
      { step: "SELL", books: [
        { title: "Never Split the Difference", author: "Chris Voss" },
        { title: "Meditations", author: "Marcus Aurelius" },
        { title: "The War of Art", author: "Steven Pressfield" },
        { title: "Letters from a Self-Made Merchant to His Son", author: "George Horace Lorimer" },
      ]},
      { step: "BUILD", books: [
        { title: "Zero to One", author: "Peter Thiel" },
        { title: "Shoe Dog", author: "Phil Knight" },
        { title: "Steve Jobs", author: "Walter Isaacson" },
        { title: "Anything You Want", author: "Derek Sivers" },
      ]},
      { step: "VALIDATE", books: [
        { title: "The Lean Startup", author: "Eric Ries" },
        { title: "Thinking in Bets", author: "Annie Duke" },
        { title: "The Goal", author: "Eliyahu Goldratt" },
        { title: "The Richest Man in Babylon", author: "George S. Clason" },
      ]},
      { step: "GROW", books: [
        { title: "The Psychology of Money", author: "Morgan Housel" },
        { title: "Rework", author: "Jason Fried & David Heinemeier Hansson" },
        { title: "Man's Search for Meaning", author: "Viktor Frankl" },
        { title: "The E-Myth Revisited", author: "Michael E. Gerber" },
      ]},
      { step: "SCALE", books: [
        { title: "The Prince", author: "Niccol\u00f2 Machiavelli" },
        { title: "The Autobiography of Benjamin Franklin", author: "Benjamin Franklin" },
        { title: "The Almanack of Naval Ravikant", author: "Eric Jorgenson" },
        { title: "Sapiens", author: "Yuval Noah Harari" },
      ]},
    ],
  },
];

// ---- Kid-voice variants (used by the Kids toggle) ----
export const dateNotesKid = [
  "\u2605 Demo Day Workshops \u2014 you present your business on stage for the cohort and parents.",
  "The year kicks off Saturday, September 19, takes a break for the winter holidays, and is back January 9.",
  "Plus one surprise session added later as the year goes on.",
];

export const pathStepsKid = [
  {
    subtitle: "Learn to sell anything, to anyone.",
    principle: "It all starts with a stranger saying yes. Before you build anything, you learn to sell something.",
    parentsSee: "You'll pitch your parents, then pitch strangers. Your first real sale usually happens faster than you'd think.",
    criteria: [
      "Pitch a product in 60 seconds to an adult who isn't family, no notes.",
      "Make a real sale to a real customer who isn't family, for real money (a charity donation counts).",
      "Hear \u201cno\u201d at least three times and write down what each no taught you.",
      "Explain the cost, price, and profit of something you made, on one page.",
      "Do 25 supervised outreach tries: a booth, door to door, calls, or messages.",
    ],
  },
  {
    subtitle: "Build something real with AI.",
    principle: "You stop just using technology and start building with it.",
    parentsSee: "A link you can open. A thing that actually works. Built by you, with an AI co-founder, in days not months.",
    criteria: [
      "Ship a working product, site, or offer built with AI tools, with a live URL, pricing, and how-to-use instructions.",
      "In a 1-page brief, explain how your product fills a gap you spotted in something you actually know about.",
      "Contact 40 possible customers. Launch one piece of marketing and track how it did.",
      "Ship a v2 that responds to feedback from at least three real users.",
      "Give a 3-5 minute live demo: your results and what you learned about building.",
    ],
  },
  {
    subtitle: "Test your ideas like a scientist.",
    principle: "Most business ideas are wrong. The skill is finding out fast and cheap.",
    parentsSee: "You stop defending your ideas and start testing them. This is where you learn to love being wrong fast.",
    criteria: [
      "Run at least 2 validation loops. Each one has a guess, a test, and an outcome.",
      "Run a pricing experiment with real price points, the margin math, and feedback from two groups of customers.",
      "Turn in an AI-tool audit: which tools you picked, why, and how they worked, for at least 3 new tools since Day 1.",
      "With zero adult help, pick your own way to test an idea. Present your thinking and result on a Saturday.",
      "Publish two pieces of content (your parents' accounts are fine) that get real engagement: comments, shares, DMs, or reposts.",
    ],
  },
  {
    subtitle: "Turn a working idea into a real business.",
    principle: "One sale is a story. Repeat sales are a business.",
    parentsSee: "You'll read your own P&L and know which week was your best and why. Most adults can't do that.",
    criteria: [
      "Hit 10 sales or 3 repeat customers.",
      "Track a simple profit and loss sheet for four weeks straight of real business activity.",
      "Set up one daily or weekly repeating AI process (Claude Cowork or an AI agent) that helps your business.",
      "Close at least one real negotiation with the terms written down.",
      "Present your financials to the cohort the way a founder presents to a board.",
    ],
  },
  {
    subtitle: "Set it up so the business runs without you glued to it.",
    principle: "The last phase is the founder's move: making the business bigger than your own hours.",
    parentsSee: "The end state of finishing The Path 1.0: you own a small machine, not a chore. That's the founder's mindset, at any size.",
    criteria: [
      "Automate one real part of your business with an AI agent or automation, and show it running.",
      "Delegate a task, to a friend, a sibling, or an AI agent, with written instructions that actually worked.",
      "Keep the business serving customers through a week you took off.",
      "Write the one-page playbook someone else could use to run it.",
      "Pitch what your business becomes next year, on stage, at an intensive.",
    ],
  },
];
