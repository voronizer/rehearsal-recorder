import type { Meta, StoryObj } from "@storybook/react-vite"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "./input-otp"

const meta = {
  title: "UI/InputOTP",
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

/** A short code, one box to a character. */
export const Default: Story = {
  render: () => (
    <InputOTP maxLength={6} defaultValue="123">
      <InputOTPGroup>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTP>
  ),
}
