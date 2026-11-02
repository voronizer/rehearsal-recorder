# Inter, for the link picture

Inter 4.0 by The Inter Project Authors, under the SIL Open Font License 1.1
(LICENSE.txt). The files are Ubuntu's `fonts-inter` 4.0+ds-1, the package the
site's CI used to install with apt, so the picture is drawn in the same font
as before.

Only the four weights the app draws in are here: Regular, Medium, SemiBold
and Bold. Without Bold a song's name in the picture comes out thinner.

The site's CI step (.github/actions/site) gives them to the machine's user,
with `../og-fonts.conf`, before it draws `og.png`. The site itself does not
load them.
