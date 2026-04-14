{{- define "account-service.fullname" -}}
{{- printf "%s-account-service" .Release.Name -}}
{{- end -}}

{{- define "account-service.labels" -}}
app.kubernetes.io/name: account-service
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: microbank
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "account-service.selectorLabels" -}}
app.kubernetes.io/name: account-service
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
