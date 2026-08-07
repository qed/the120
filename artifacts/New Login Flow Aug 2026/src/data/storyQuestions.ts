import type { StoryQuestion } from '../types/onboarding';

export const storyQuestions: StoryQuestion[] = [
{
  id: 'intro',
  question: 'Who are you and what are 3 things you like to do?',
  sample:
  'My name is Remi Newal, and I am nine years old. I like playing soccer, hanging out with my friends, going on vacations, and learning about stocks and businesses.',
  rows: 4
},
{
  id: 'why',
  question: 'Why do you want to start a business?',
  hint: 'Including any ideas you have or businesses you have previously worked on.',
  sample:
  'I want to start a business because I think making a business is fun. I like talking about stocks, companies, and how businesses work.\n\nI started a leaf-raking business in our neighbourhood and ran it for about a month. I made some money, but I also learned that starting a business is fun and rewarding. When you work hard, it can really pay off.',
  rows: 6
},
{
  id: 'start',
  question: 'If you did start or have started a business, how did it start?',
  hint: 'Give me the first few things you did.',
  sample:
  'We started on Silver Birch Avenue by knocking on a few doors and asking people if they needed their leaves raked. We got a few customers, and our very first customer paid us $14 for raking 12 bags of leaves.\n\nWe used some of the money we earned to buy more bags and supplies so we could keep raking and grow the business.',
  rows: 6
},
{
  id: 'inspires',
  question: 'Who inspires you?',
  sample:
  'My dad inspires me because he started and runs a company. Watching him has helped me learn more about how businesses work and has made me want to create a company of my own one day.',
  rows: 4
},
{
  id: 'idea',
  question: 'What kind of business would you like to start?',
  sample:
  'That is a hard question because I have a few ideas!\n\nOne idea would be selling things like ice cream or lemonade. Another idea would be starting a small service company and creating a website so people could find my services online.',
  rows: 5
},
{
  id: 'matters',
  question: 'What matters most to you?',
  hint: 'Sports, job when you grow up, activities, etc.',
  sample:
  'Soccer matters a lot to me, and one day I would love to become a soccer player.\n\nI would also love to have a secret undercover job as a geologist!',
  rows: 5
}];


export const INTRO_IMAGE = "/First_Profit_Intro_Image.jpg";


export const TEST_KID_PHOTO = "/Caradoc_Photo.jpg";


/** The template redrawn with the uploaded kid as the hero. */
export const PERSONALIZED_COVER_IMAGE = "/8c0b8bec-b6a4-42a3-b399-1aa9e698fead.jpg";