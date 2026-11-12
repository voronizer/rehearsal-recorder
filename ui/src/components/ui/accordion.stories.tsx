import type { Meta, StoryObj } from "@storybook/react-vite"
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "./accordion"

const meta = {
  title: "UI/Accordion",
  component: Accordion,
  args: { type: "single" },
} satisfies Meta<typeof Accordion>

export default meta
type Story = StoryObj<typeof meta>

/** Sections that fold; one open at a time. */
export const Default: Story = {
  render: () => (
    <Accordion type="single" collapsible defaultValue="one" className="w-80">
      <AccordionItem value="one">
        <AccordionTrigger>Where do takes go?</AccordionTrigger>
        <AccordionContent>To the folder you picked in Settings.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="two">
        <AccordionTrigger>Can I move them?</AccordionTrigger>
        <AccordionContent>Yes. РЭХА finds them where they are.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
}
