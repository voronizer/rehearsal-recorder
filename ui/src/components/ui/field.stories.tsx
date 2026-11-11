import type { Meta, StoryObj } from "@storybook/react-vite"
import { Field, FieldDescription, FieldError, FieldLabel } from "./field"
import { Input } from "./input"

const meta = {
  title: "UI/Field",
  component: Field,
} satisfies Meta<typeof Field>

export default meta
type Story = StoryObj<typeof meta>

/** A label, the control, a line under it. */
export const Default: Story = {
  render: () => (
    <Field className="w-72">
      <FieldLabel htmlFor="band">Band name</FieldLabel>
      <Input id="band" defaultValue="Dym" />
      <FieldDescription>Shown on the page your band shares.</FieldDescription>
    </Field>
  ),
}

export const WithError: Story = {
  render: () => (
    <Field className="w-72" data-invalid>
      <FieldLabel htmlFor="band2">Band name</FieldLabel>
      <Input id="band2" aria-invalid defaultValue="" />
      <FieldError>Give the band a name.</FieldError>
    </Field>
  ),
}
